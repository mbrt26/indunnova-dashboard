#!/usr/bin/env python3
"""
Script para consolidar errores, analizarlos con Claude y crear issues en GitHub.

Funcionalidades:
1. Agrupa errores duplicados/similares usando hashing
2. Usa Claude API para analisis inteligente y sugerencias
3. Crea issues en GitHub automaticamente
"""

import json
import os
import re
import hashlib
import subprocess
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from typing import Optional

# Intentar importar anthropic
try:
    import anthropic
    ANTHROPIC_AVAILABLE = True
except ImportError:
    ANTHROPIC_AVAILABLE = False
    print("Warning: anthropic package not installed. Claude analysis will be skipped.")

# Configuracion
GITHUB_REPO = "mbrt26/indunnova-dashboard"
MIN_OCCURRENCES_FOR_ISSUE = 3  # Minimo de ocurrencias para crear issue
MAX_ISSUES_PER_RUN = 10  # Maximo de issues a crear por ejecucion


def normalize_error_message(message: str) -> str:
    """Normaliza un mensaje de error para comparacion."""
    if not message:
        return ""

    # Remover timestamps
    normalized = re.sub(r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}', '[TIMESTAMP]', message)

    # Remover IDs numericos largos
    normalized = re.sub(r'\b\d{10,}\b', '[ID]', normalized)

    # Remover UUIDs
    normalized = re.sub(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '[UUID]', normalized, flags=re.IGNORECASE)

    # Remover paths con IDs
    normalized = re.sub(r'/\d+/', '/[ID]/', normalized)

    # Remover direcciones IP
    normalized = re.sub(r'\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}', '[IP]', normalized)

    # Remover hex addresses
    normalized = re.sub(r'0x[0-9a-fA-F]+', '[HEX]', normalized)

    # Normalizar espacios
    normalized = ' '.join(normalized.split())

    return normalized


def get_error_hash(service: str, message: str) -> str:
    """Genera un hash unico para un tipo de error."""
    normalized = normalize_error_message(message)
    # Tomar las primeras 500 caracteres del mensaje normalizado
    key = f"{service}:{normalized[:500]}"
    return hashlib.md5(key.encode()).hexdigest()[:12]


def extract_error_type(message: str) -> str:
    """Extrae el tipo de error del mensaje."""
    if not message:
        return "Unknown Error"

    # Patrones comunes de Python
    patterns = [
        r'(\w+Error):\s',
        r'(\w+Exception):\s',
        r'(\w+Warning):\s',
        r'HTTP (\d{3})',
        r'status[=:\s]+(\d{3})',
    ]

    for pattern in patterns:
        match = re.search(pattern, message)
        if match:
            return match.group(1)

    # Tomar la primera linea como tipo
    first_line = message.split('\n')[0][:100]
    return first_line if first_line else "Unknown Error"


def consolidate_errors(errors: list) -> dict:
    """Agrupa errores similares."""
    groups = defaultdict(lambda: {
        'count': 0,
        'services': set(),
        'first_seen': None,
        'last_seen': None,
        'sample_message': '',
        'sample_http': None,
        'occurrences': [],
        'error_type': '',
        'revisions': set()
    })

    for error in errors:
        service = error.get('service', 'unknown')
        message = error.get('message', '')
        timestamp = error.get('timestamp', '')

        error_hash = get_error_hash(service, message)
        group = groups[error_hash]

        group['count'] += 1
        group['services'].add(service)

        if error.get('revision'):
            group['revisions'].add(error['revision'])

        # Actualizar timestamps
        if timestamp:
            if not group['first_seen'] or timestamp < group['first_seen']:
                group['first_seen'] = timestamp
            if not group['last_seen'] or timestamp > group['last_seen']:
                group['last_seen'] = timestamp

        # Guardar muestra
        if not group['sample_message']:
            group['sample_message'] = message
            group['sample_http'] = error.get('httpRequest')
            group['error_type'] = extract_error_type(message)

        # Guardar algunas ocurrencias para contexto
        if len(group['occurrences']) < 5:
            group['occurrences'].append({
                'timestamp': timestamp,
                'service': service,
                'revision': error.get('revision', ''),
                'http_status': error.get('httpRequest', {}).get('status') if error.get('httpRequest') else None
            })

    # Convertir sets a listas para JSON
    result = {}
    for hash_id, group in groups.items():
        result[hash_id] = {
            **group,
            'services': list(group['services']),
            'revisions': list(group['revisions'])
        }

    return result


def analyze_with_claude(consolidated_errors: dict, api_key: str) -> dict:
    """Usa Claude para analizar errores y sugerir soluciones."""
    if not ANTHROPIC_AVAILABLE:
        return {}

    client = anthropic.Anthropic(api_key=api_key)
    analyses = {}

    # Ordenar por cantidad de ocurrencias
    sorted_errors = sorted(
        consolidated_errors.items(),
        key=lambda x: x[1]['count'],
        reverse=True
    )[:MAX_ISSUES_PER_RUN]  # Limitar para no exceder tokens

    for error_hash, error_data in sorted_errors:
        if error_data['count'] < MIN_OCCURRENCES_FOR_ISSUE:
            continue

        # Preparar contexto para Claude
        prompt = f"""Analiza este error de una aplicacion Django en Google Cloud Run.

SERVICIO(S): {', '.join(error_data['services'])}
TIPO DE ERROR: {error_data['error_type']}
OCURRENCIAS: {error_data['count']} veces
PRIMERA VEZ: {error_data['first_seen']}
ULTIMA VEZ: {error_data['last_seen']}

MENSAJE DE ERROR:
```
{error_data['sample_message'][:2000]}
```

{f"HTTP INFO: {error_data['sample_http']}" if error_data['sample_http'] else ""}

Por favor proporciona:
1. **Resumen**: Una descripcion breve del problema (1-2 oraciones)
2. **Causa Probable**: Que esta causando este error
3. **Impacto**: Nivel de severidad (critico/alto/medio/bajo) y por que
4. **Solucion Sugerida**: Pasos concretos para resolver el problema
5. **Prevencion**: Como evitar que ocurra en el futuro

Responde en formato estructurado y conciso."""

        try:
            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=1000,
                messages=[{"role": "user", "content": prompt}]
            )

            analyses[error_hash] = {
                'analysis': response.content[0].text,
                'analyzed_at': datetime.now(timezone.utc).isoformat()
            }

        except Exception as e:
            print(f"Error analizando con Claude: {e}")
            analyses[error_hash] = {
                'analysis': None,
                'error': str(e)
            }

    return analyses


def check_existing_issues(error_hash: str) -> Optional[str]:
    """Verifica si ya existe un issue para este error."""
    try:
        result = subprocess.run(
            f'gh issue list --repo {GITHUB_REPO} --search "ERROR-{error_hash}" --json number,url --limit 1',
            shell=True, capture_output=True, text=True, timeout=30
        )
        if result.stdout.strip():
            issues = json.loads(result.stdout)
            if issues:
                return issues[0]['url']
    except Exception as e:
        print(f"Error verificando issues existentes: {e}")
    return None


def create_github_issue(error_hash: str, error_data: dict, analysis: Optional[dict] = None) -> Optional[str]:
    """Crea un issue en GitHub para el error."""

    # Verificar si ya existe
    existing = check_existing_issues(error_hash)
    if existing:
        print(f"  Issue ya existe: {existing}")
        return existing

    # Construir titulo
    services = ', '.join(error_data['services'][:3])
    if len(error_data['services']) > 3:
        services += f" +{len(error_data['services']) - 3}"

    title = f"[ERROR-{error_hash}] {error_data['error_type']} en {services}"
    if len(title) > 100:
        title = title[:97] + "..."

    # Construir body
    body_parts = [
        f"## Resumen del Error",
        f"",
        f"| Metrica | Valor |",
        f"|---------|-------|",
        f"| **ID** | `ERROR-{error_hash}` |",
        f"| **Tipo** | {error_data['error_type']} |",
        f"| **Ocurrencias** | {error_data['count']} |",
        f"| **Servicios** | {', '.join(error_data['services'])} |",
        f"| **Primera vez** | {error_data['first_seen']} |",
        f"| **Ultima vez** | {error_data['last_seen']} |",
        f"| **Revisions** | {', '.join(error_data['revisions'][:5])} |",
        f"",
    ]

    # Agregar analisis de Claude si existe
    if analysis and analysis.get('analysis'):
        body_parts.extend([
            f"## Analisis (Claude)",
            f"",
            analysis['analysis'],
            f"",
            f"---",
            f"*Analizado: {analysis.get('analyzed_at', 'N/A')}*",
            f"",
        ])

    # Mensaje de error
    sample_msg = error_data['sample_message']
    if len(sample_msg) > 3000:
        sample_msg = sample_msg[:3000] + "\n... [truncado]"

    body_parts.extend([
        f"## Mensaje de Error",
        f"",
        f"```",
        sample_msg,
        f"```",
        f"",
    ])

    # HTTP info si existe
    if error_data['sample_http']:
        http = error_data['sample_http']
        body_parts.extend([
            f"## Informacion HTTP",
            f"",
            f"- **Metodo**: {http.get('method', 'N/A')}",
            f"- **URL**: {http.get('url', 'N/A')}",
            f"- **Status**: {http.get('status', 'N/A')}",
            f"- **Latencia**: {http.get('latency', 'N/A')}",
            f"",
        ])

    # Ocurrencias recientes
    body_parts.extend([
        f"## Ocurrencias Recientes",
        f"",
        f"| Timestamp | Servicio | Revision |",
        f"|-----------|----------|----------|",
    ])
    for occ in error_data['occurrences'][:5]:
        body_parts.append(f"| {occ['timestamp']} | {occ['service']} | {occ['revision']} |")

    body_parts.extend([
        f"",
        f"---",
        f"*Issue creado automaticamente por el sistema de monitoreo*",
        f"*Ver dashboard: https://mbrt26.github.io/indunnova-dashboard/errors.html*"
    ])

    body = '\n'.join(body_parts)

    # Determinar labels (usar solo labels que existen)
    labels = ["bug", "auto-generated"]
    if error_data['count'] >= 50:
        labels.append("priority-high")
    elif error_data['count'] >= 10:
        labels.append("priority-medium")
    else:
        labels.append("priority-low")

    # Crear issue
    try:
        labels_str = ','.join(labels)
        cmd = f'''gh issue create --repo {GITHUB_REPO} --title "{title}" --body "$(cat <<'EOFBODY'
{body}
EOFBODY
)" --label "{labels_str}"'''

        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=60)

        if result.returncode == 0:
            issue_url = result.stdout.strip()
            print(f"  Issue creado: {issue_url}")
            return issue_url
        else:
            print(f"  Error creando issue: {result.stderr}")
            return None

    except Exception as e:
        print(f"  Error creando issue: {e}")
        return None


def main():
    """Funcion principal."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(os.path.dirname(script_dir), 'data')

    # Cargar errores
    errors_path = os.path.join(data_dir, 'errors.json')
    if not os.path.exists(errors_path):
        print(f"Archivo no encontrado: {errors_path}")
        print("Ejecute primero update_data.py")
        return

    with open(errors_path, 'r') as f:
        errors = json.load(f)

    print(f"Cargados {len(errors)} errores")

    # Consolidar errores
    print("\nConsolidando errores...")
    consolidated = consolidate_errors(errors)
    print(f"  {len(consolidated)} grupos de errores unicos")

    # Filtrar por minimo de ocurrencias
    significant_errors = {
        k: v for k, v in consolidated.items()
        if v['count'] >= MIN_OCCURRENCES_FOR_ISSUE
    }
    print(f"  {len(significant_errors)} grupos con >= {MIN_OCCURRENCES_FOR_ISSUE} ocurrencias")

    # Guardar errores consolidados
    consolidated_path = os.path.join(data_dir, 'consolidated_errors.json')
    with open(consolidated_path, 'w') as f:
        json.dump(consolidated, f, indent=2)
    print(f"  Guardado: {consolidated_path}")

    # Analizar con Claude si hay API key
    api_key = os.environ.get('ANTHROPIC_API_KEY')
    analyses = {}

    if api_key and ANTHROPIC_AVAILABLE:
        print("\nAnalizando con Claude...")
        analyses = analyze_with_claude(significant_errors, api_key)
        print(f"  {len(analyses)} errores analizados")

        # Guardar analisis
        analyses_path = os.path.join(data_dir, 'error_analyses.json')
        with open(analyses_path, 'w') as f:
            json.dump(analyses, f, indent=2)
        print(f"  Guardado: {analyses_path}")
    else:
        print("\nSaltando analisis con Claude (ANTHROPIC_API_KEY no configurada)")

    # Crear issues
    print("\nCreando issues en GitHub...")
    created_issues = []

    # Ordenar por cantidad de ocurrencias
    sorted_errors = sorted(
        significant_errors.items(),
        key=lambda x: x[1]['count'],
        reverse=True
    )[:MAX_ISSUES_PER_RUN]

    for error_hash, error_data in sorted_errors:
        print(f"\nProcesando ERROR-{error_hash} ({error_data['count']} ocurrencias)...")
        analysis = analyses.get(error_hash)
        issue_url = create_github_issue(error_hash, error_data, analysis)

        if issue_url:
            created_issues.append({
                'hash': error_hash,
                'url': issue_url,
                'count': error_data['count'],
                'services': error_data['services']
            })

    # Guardar registro de issues creados
    issues_log_path = os.path.join(data_dir, 'created_issues.json')
    existing_issues = []
    if os.path.exists(issues_log_path):
        with open(issues_log_path, 'r') as f:
            existing_issues = json.load(f)

    existing_issues.extend(created_issues)

    with open(issues_log_path, 'w') as f:
        json.dump(existing_issues, f, indent=2)

    print(f"\n{'='*50}")
    print(f"Resumen:")
    print(f"  Errores totales: {len(errors)}")
    print(f"  Grupos consolidados: {len(consolidated)}")
    print(f"  Grupos significativos: {len(significant_errors)}")
    print(f"  Issues creados: {len(created_issues)}")
    print(f"{'='*50}")


if __name__ == '__main__':
    main()
