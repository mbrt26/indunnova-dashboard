#!/usr/bin/env python3
"""
Script para actualizar los datos del dashboard de Indunnova.
Obtiene información de Cloud Run, logs y GitHub para generar los archivos JSON.
"""

import json
import subprocess
import os
from datetime import datetime, timezone, timedelta
from collections import defaultdict

# Mapeo de servicios Cloud Run a repositorios
SERVICE_TO_REPO = {
    'arcopack-erp': 'Arcopack',
    'carnesdelsebastian': 'carnesdelsebastian',
    'codeta-crm': 'CODETA',
    'colsegur': 'Colsegur',
    'crm-contenedores': 'ObrajeCRM',
    'crm-ecourmet': 'EcourmetV2',
    'crm-gyt': 'GYT',
    'crm-komsa': 'KOMSA',
    'formas-futuro': 'FormasFuturo',
    'fundiciones-medellin': 'FundicionesMedellin',
    'gestion-proveedores-isa': 'GestionProveedoresISA',
    'hemisferio-erp': 'Hemisferio',
    'huella-carbono': 'HuellaCarbono',
    'jardin-botanico': 'JardinBotanico',
    'logiempresas': 'Logiempresas',
    'mentes-estrategicas': 'mentes_estrategicas',
    'moldes-mecanizados-app': 'MoldesyMecanizados',
    'mouse-digital': 'MouseDigital',
    'novapcr-app': 'NOVAPCR',
    'plasticos-ambientales': 'PlasticosAmbientales',
    'rgd-aire': 'RGDAire',
    'seyca': 'seyca_produccion',
    'seyca-produccion': 'seyca_produccion',
    'tersasoft': 'tersaSoft',
    'vid-comunicaciones': 'VID',
}

GITHUB_ORG = 'mbrt26'
PROJECT_NUMBER = '381877373634'  # Google Cloud project number for appsindunnova

def run_command(cmd, timeout=120):
    """Ejecuta un comando y retorna su salida."""
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return result.stdout.strip()
    except Exception as e:
        print(f"Error ejecutando comando: {e}")
        return ""

def get_cloud_run_services():
    """Obtiene la lista de servicios de Cloud Run."""
    cmd = 'gcloud run services list --format="json" 2>/dev/null'
    output = run_command(cmd)

    if not output:
        return []

    try:
        data = json.loads(output)
        services = []

        for svc in data:
            name = svc['metadata']['name']

            # Obtener estado
            conditions = svc['status'].get('conditions', [])
            status = 'Unknown'
            for c in conditions:
                if c['type'] == 'Ready':
                    status = c['status']
                    break

            # Obtener región
            region = svc['metadata'].get('labels', {}).get('cloud.googleapis.com/location', 'us-central1')

            # Generar URL con el nuevo formato (usando project number)
            # Nuevo formato: https://{service}-{project_number}.{region}.run.app
            url = f"https://{name}-{PROJECT_NUMBER}.{region}.run.app"

            # Mapear a repositorio
            repo_name = SERVICE_TO_REPO.get(name)
            repo_url = f"https://github.com/{GITHUB_ORG}/{repo_name}" if repo_name else None

            services.append({
                'name': name,
                'url': url,
                'status': status,
                'region': region,
                'repo': repo_url,
                'repoName': repo_name
            })

        return services
    except json.JSONDecodeError as e:
        print(f"Error parseando JSON de Cloud Run: {e}")
        return []

def get_error_logs():
    """Obtiene los errores de los últimos 7 días agrupados por servicio."""
    # Obtener errores de los últimos 7 días
    cmd = '''gcloud logging read 'resource.type="cloud_run_revision" AND severity>=ERROR' --limit=1000 --format="json" --freshness=7d 2>/dev/null'''
    output = run_command(cmd, timeout=180)

    if not output:
        return {}

    try:
        data = json.loads(output)
        errors_by_service = defaultdict(lambda: {
            'total': 0,
            'last24h': 0,
            'last7d': 0,
            'recentErrors': []
        })

        now = datetime.now(timezone.utc)
        day_ago = now - timedelta(days=1)

        for log in data:
            resource = log.get('resource', {})
            labels = resource.get('labels', {})
            service_name = labels.get('service_name', 'unknown')
            timestamp_str = log.get('timestamp', '')
            severity = log.get('severity', 'ERROR')

            # Parsear timestamp
            try:
                timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
            except:
                timestamp = now

            errors_by_service[service_name]['total'] += 1
            errors_by_service[service_name]['last7d'] += 1

            if timestamp > day_ago:
                errors_by_service[service_name]['last24h'] += 1

            # Guardar los últimos 3 errores
            if len(errors_by_service[service_name]['recentErrors']) < 3:
                error_text = log.get('textPayload', '')
                if not error_text:
                    json_payload = log.get('jsonPayload', {})
                    error_text = json_payload.get('message', str(json_payload)[:200])

                # Truncar mensaje largo
                if len(error_text) > 300:
                    error_text = error_text[:300] + '...'

                errors_by_service[service_name]['recentErrors'].append({
                    'timestamp': timestamp_str,
                    'message': error_text,
                    'severity': severity
                })

        return dict(errors_by_service)
    except json.JSONDecodeError as e:
        print(f"Error parseando JSON de logs: {e}")
        return {}

def get_deployments():
    """Obtiene el historial de despliegues (revisiones) por servicio."""
    cmd = '''gcloud run revisions list --region=us-central1 --limit=200 --format="json" 2>/dev/null'''
    output = run_command(cmd, timeout=120)

    if not output:
        return {}

    try:
        data = json.loads(output)
        deployments_by_service = defaultdict(lambda: {
            'total': 0,
            'last24h': 0,
            'last7d': 0,
            'lastDeployment': None,
            'recentDeployments': []
        })

        now = datetime.now(timezone.utc)
        day_ago = now - timedelta(days=1)
        week_ago = now - timedelta(days=7)

        for rev in data:
            metadata = rev.get('metadata', {})
            name = metadata.get('name', '')
            creation_time = metadata.get('creationTimestamp', '')

            # Extraer nombre del servicio de la revisión
            # Formato: service-name-00001-xyz
            parts = name.rsplit('-', 2)
            if len(parts) >= 3:
                service_name = '-'.join(parts[:-2])
            else:
                service_name = name

            # Parsear timestamp
            try:
                timestamp = datetime.fromisoformat(creation_time.replace('Z', '+00:00'))
            except:
                timestamp = now

            deployments_by_service[service_name]['total'] += 1

            if timestamp > week_ago:
                deployments_by_service[service_name]['last7d'] += 1

            if timestamp > day_ago:
                deployments_by_service[service_name]['last24h'] += 1

            # Guardar el último despliegue
            if deployments_by_service[service_name]['lastDeployment'] is None:
                deployments_by_service[service_name]['lastDeployment'] = creation_time

            # Guardar los últimos 5 despliegues
            if len(deployments_by_service[service_name]['recentDeployments']) < 5:
                status_conditions = rev.get('status', {}).get('conditions', [])
                ready = 'Unknown'
                for c in status_conditions:
                    if c.get('type') == 'Ready':
                        ready = c.get('status', 'Unknown')
                        break

                deployments_by_service[service_name]['recentDeployments'].append({
                    'revision': name,
                    'timestamp': creation_time,
                    'status': ready
                })

        return dict(deployments_by_service)
    except json.JSONDecodeError as e:
        print(f"Error parseando JSON de revisiones: {e}")
        return {}

def get_request_metrics():
    """Obtiene métricas de requests HTTP de los últimos 7 días."""
    # Obtener requests con errores 5xx
    cmd = '''gcloud logging read 'resource.type="cloud_run_revision" AND httpRequest.status>=500' --limit=500 --format="json" --freshness=7d 2>/dev/null'''
    output = run_command(cmd, timeout=180)

    metrics_by_service = defaultdict(lambda: {
        'errors5xx': 0,
        'errors4xx': 0,
        'avgLatencyMs': 0,
        'latencySamples': []
    })

    if output:
        try:
            data = json.loads(output)
            for log in data:
                resource = log.get('resource', {})
                labels = resource.get('labels', {})
                service_name = labels.get('service_name', 'unknown')
                http_request = log.get('httpRequest', {})
                status = http_request.get('status', 0)

                if status >= 500:
                    metrics_by_service[service_name]['errors5xx'] += 1
                elif status >= 400:
                    metrics_by_service[service_name]['errors4xx'] += 1

                # Obtener latencia
                latency = http_request.get('latency', '')
                if latency:
                    try:
                        # Formato: "0.123456s"
                        latency_sec = float(latency.rstrip('s'))
                        latency_ms = int(latency_sec * 1000)
                        metrics_by_service[service_name]['latencySamples'].append(latency_ms)
                    except:
                        pass
        except json.JSONDecodeError:
            pass

    # Calcular promedios de latencia
    for service_name, metrics in metrics_by_service.items():
        samples = metrics['latencySamples']
        if samples:
            metrics['avgLatencyMs'] = sum(samples) // len(samples)
        del metrics['latencySamples']

    return dict(metrics_by_service)

def get_user_interactions():
    """Obtiene el conteo de interacciones de usuarios (requests HTTP) por servicio."""
    interactions_by_service = defaultdict(lambda: {
        'requests7d': 0,
        'requests30d': 0
    })

    # Obtener requests de los últimos 30 días
    # Usamos httpRequest para contar solo requests HTTP reales (no logs internos)
    print("  Obteniendo requests de 30 días...")
    cmd_30d = '''gcloud logging read 'resource.type="cloud_run_revision" AND httpRequest.requestMethod!=""' --limit=10000 --format="json" --freshness=30d 2>/dev/null'''
    output_30d = run_command(cmd_30d, timeout=300)

    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)

    if output_30d:
        try:
            data = json.loads(output_30d)
            for log in data:
                resource = log.get('resource', {})
                labels = resource.get('labels', {})
                service_name = labels.get('service_name', 'unknown')
                timestamp_str = log.get('timestamp', '')

                # Parsear timestamp
                try:
                    timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                except:
                    timestamp = now

                # Contar para 30 días
                interactions_by_service[service_name]['requests30d'] += 1

                # Contar para 7 días
                if timestamp > week_ago:
                    interactions_by_service[service_name]['requests7d'] += 1

        except json.JSONDecodeError as e:
            print(f"  Error parseando JSON de interacciones: {e}")

    return dict(interactions_by_service)

def get_service_configurations():
    """Obtiene la configuración de CPU y memoria de cada servicio para estimar costos."""
    cmd = 'gcloud run services list --format="json" 2>/dev/null'
    output = run_command(cmd)

    if not output:
        return {}

    try:
        data = json.loads(output)
        configs = {}

        for svc in data:
            name = svc['metadata']['name']
            spec = svc.get('spec', {}).get('template', {}).get('spec', {})
            containers = spec.get('containers', [{}])

            if containers:
                resources = containers[0].get('resources', {}).get('limits', {})
                cpu = resources.get('cpu', '1')
                memory = resources.get('memory', '512Mi')

                # Convertir CPU a número
                if cpu.endswith('m'):
                    cpu_cores = float(cpu.rstrip('m')) / 1000
                else:
                    cpu_cores = float(cpu)

                # Convertir memoria a GiB
                if memory.endswith('Gi'):
                    memory_gib = float(memory.rstrip('Gi'))
                elif memory.endswith('Mi'):
                    memory_gib = float(memory.rstrip('Mi')) / 1024
                elif memory.endswith('G'):
                    memory_gib = float(memory.rstrip('G'))
                elif memory.endswith('M'):
                    memory_gib = float(memory.rstrip('M')) / 1024
                else:
                    memory_gib = 0.5  # Default

                configs[name] = {
                    'cpu': cpu_cores,
                    'memoryGiB': memory_gib,
                    'cpuRaw': cpu,
                    'memoryRaw': memory
                }

        return configs
    except json.JSONDecodeError as e:
        print(f"Error parseando configuración de servicios: {e}")
        return {}


def estimate_monthly_cost(config, interactions, avg_latency_ms):
    """
    Estima el costo mensual de un servicio Cloud Run.

    Precios de Cloud Run (us-central1):
    - CPU: $0.00002400 por vCPU-segundo
    - Memoria: $0.00000250 por GiB-segundo
    - Requests: $0.40 por millón de requests
    - Tier gratuito: 2 millones de requests, 360,000 vCPU-segundos, 180,000 GiB-segundos
    """
    CPU_PRICE_PER_VCPU_SECOND = 0.00002400
    MEMORY_PRICE_PER_GIB_SECOND = 0.00000250
    REQUEST_PRICE_PER_MILLION = 0.40

    # Estimar requests mensuales (30 días) basado en datos de 30d
    requests_30d = interactions.get('requests30d', 0)
    # Proyectar a mes completo si tenemos menos de 30 días de datos
    estimated_monthly_requests = requests_30d

    # Estimar tiempo de ejecución
    # Usar latencia promedio, o asumir 500ms si no hay datos
    if avg_latency_ms <= 0:
        avg_latency_ms = 500  # Default 500ms por request

    # Tiempo total de ejecución en segundos
    # Considerando que Cloud Run cobra mínimo 100ms por request
    min_billable_ms = max(avg_latency_ms, 100)
    total_execution_seconds = (estimated_monthly_requests * min_billable_ms) / 1000

    # Costos
    cpu_cost = config.get('cpu', 1) * total_execution_seconds * CPU_PRICE_PER_VCPU_SECOND
    memory_cost = config.get('memoryGiB', 0.5) * total_execution_seconds * MEMORY_PRICE_PER_GIB_SECOND
    request_cost = (estimated_monthly_requests / 1_000_000) * REQUEST_PRICE_PER_MILLION

    # Total
    total_cost = cpu_cost + memory_cost + request_cost

    return {
        'estimatedMonthly': round(total_cost, 2),
        'cpuCost': round(cpu_cost, 2),
        'memoryCost': round(memory_cost, 2),
        'requestCost': round(request_cost, 2),
        'estimatedRequests': estimated_monthly_requests,
        'avgLatencyMs': avg_latency_ms,
        'cpuCores': config.get('cpu', 1),
        'memoryGiB': config.get('memoryGiB', 0.5)
    }


def get_all_errors_detailed():
    """Obtiene todos los errores detallados de los últimos 7 días."""
    cmd = '''gcloud logging read 'resource.type="cloud_run_revision" AND severity>=ERROR' --limit=2000 --format="json" --freshness=7d 2>/dev/null'''
    output = run_command(cmd, timeout=300)

    if not output:
        return []

    try:
        data = json.loads(output)
        errors = []

        for log in data:
            resource = log.get('resource', {})
            labels = resource.get('labels', {})
            service_name = labels.get('service_name', 'unknown')
            revision_name = labels.get('revision_name', '')
            timestamp_str = log.get('timestamp', '')
            severity = log.get('severity', 'ERROR')
            insert_id = log.get('insertId', '')

            # Obtener mensaje de error
            error_text = log.get('textPayload', '')
            if not error_text:
                json_payload = log.get('jsonPayload', {})
                error_text = json_payload.get('message', '')
                if not error_text:
                    error_text = str(json_payload)[:1000] if json_payload else ''

            # Obtener información de HTTP si existe
            http_request = log.get('httpRequest', {})
            http_info = None
            if http_request:
                http_info = {
                    'method': http_request.get('requestMethod', ''),
                    'url': http_request.get('requestUrl', ''),
                    'status': http_request.get('status', 0),
                    'latency': http_request.get('latency', ''),
                    'userAgent': http_request.get('userAgent', ''),
                    'remoteIp': http_request.get('remoteIp', '')
                }

            # Obtener trace si existe
            trace = log.get('trace', '')
            span_id = log.get('spanId', '')

            errors.append({
                'id': insert_id,
                'service': service_name,
                'revision': revision_name,
                'timestamp': timestamp_str,
                'severity': severity,
                'message': error_text,
                'httpRequest': http_info,
                'trace': trace,
                'spanId': span_id
            })

        return errors
    except json.JSONDecodeError as e:
        print(f"Error parseando JSON de errores detallados: {e}")
        return []

def get_github_repos():
    """Obtiene la lista de repositorios de GitHub."""
    cmd = 'gh repo list --limit 100 --json name,url,updatedAt,description 2>/dev/null'
    output = run_command(cmd)

    if not output:
        return []

    try:
        data = json.loads(output)
        repos = []

        # Crear mapeo inverso para encontrar servicios Cloud Run
        repo_to_service = {v: k for k, v in SERVICE_TO_REPO.items()}

        for repo in data:
            cloud_run_service = repo_to_service.get(repo['name'])

            repos.append({
                'name': repo['name'],
                'url': repo['url'],
                'description': repo.get('description', ''),
                'updatedAt': repo.get('updatedAt', ''),
                'cloudRunService': cloud_run_service
            })

        return repos
    except json.JSONDecodeError as e:
        print(f"Error parseando JSON de GitHub: {e}")
        return []

def main():
    """Función principal."""
    # Determinar directorio de datos
    script_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(os.path.dirname(script_dir), 'data')

    # Crear directorio si no existe
    os.makedirs(data_dir, exist_ok=True)

    print("Obteniendo servicios de Cloud Run...")
    services = get_cloud_run_services()
    print(f"  Encontrados {len(services)} servicios")

    print("Obteniendo errores de logs...")
    errors = get_error_logs()
    print(f"  Servicios con errores: {len(errors)}")

    print("Obteniendo historial de despliegues...")
    deployments = get_deployments()
    print(f"  Servicios con despliegues: {len(deployments)}")

    print("Obteniendo métricas de requests...")
    request_metrics = get_request_metrics()
    print(f"  Servicios con métricas: {len(request_metrics)}")

    print("Obteniendo interacciones de usuarios...")
    user_interactions = get_user_interactions()
    print(f"  Servicios con interacciones: {len(user_interactions)}")

    print("Obteniendo configuración de servicios para estimar costos...")
    service_configs = get_service_configurations()
    print(f"  Servicios con configuración: {len(service_configs)}")

    print("Obteniendo repositorios de GitHub...")
    repos = get_github_repos()
    print(f"  Encontrados {len(repos)} repositorios")

    print("Obteniendo errores detallados para pagina de errores...")
    all_errors = get_all_errors_detailed()
    print(f"  Encontrados {len(all_errors)} errores detallados")

    # Combinar métricas en los servicios
    for service in services:
        name = service['name']
        service['errors'] = errors.get(name, {
            'total': 0,
            'last24h': 0,
            'last7d': 0,
            'recentErrors': []
        })
        service['deployments'] = deployments.get(name, {
            'total': 0,
            'last24h': 0,
            'last7d': 0,
            'lastDeployment': None,
            'recentDeployments': []
        })
        service['metrics'] = request_metrics.get(name, {
            'errors5xx': 0,
            'errors4xx': 0,
            'avgLatencyMs': 0
        })
        service['interactions'] = user_interactions.get(name, {
            'requests7d': 0,
            'requests30d': 0
        })

        # Calcular estimación de costos
        config = service_configs.get(name, {'cpu': 1, 'memoryGiB': 0.5})
        avg_latency = service['metrics'].get('avgLatencyMs', 0)
        service['costEstimate'] = estimate_monthly_cost(
            config,
            service['interactions'],
            avg_latency
        )

    # Calcular costo total estimado
    total_estimated_cost = sum(s['costEstimate']['estimatedMonthly'] for s in services)
    print(f"\n  Costo mensual estimado total: ${total_estimated_cost:.2f}")

    # Guardar datos
    services_path = os.path.join(data_dir, 'services.json')
    repos_path = os.path.join(data_dir, 'repos.json')
    errors_path = os.path.join(data_dir, 'errors.json')
    meta_path = os.path.join(data_dir, 'meta.json')

    with open(services_path, 'w') as f:
        json.dump(services, f, indent=2)
    print(f"  Guardado: {services_path}")

    with open(repos_path, 'w') as f:
        json.dump(repos, f, indent=2)
    print(f"  Guardado: {repos_path}")

    with open(errors_path, 'w') as f:
        json.dump(all_errors, f, indent=2)
    print(f"  Guardado: {errors_path}")

    # Calcular totales para metadatos
    total_errors_24h = sum(s['errors']['last24h'] for s in services)
    total_errors_7d = sum(s['errors']['last7d'] for s in services)
    total_deployments_24h = sum(s['deployments']['last24h'] for s in services)
    total_deployments_7d = sum(s['deployments']['last7d'] for s in services)

    # Metadatos
    meta = {
        'lastUpdate': datetime.now(timezone.utc).isoformat(),
        'project': 'appsindunnova',
        'totalServices': len(services),
        'totalRepos': len(repos),
        'healthyServices': len([s for s in services if s['status'] == 'True']),
        'unhealthyServices': len([s for s in services if s['status'] != 'True']),
        'totalErrors24h': total_errors_24h,
        'totalErrors7d': total_errors_7d,
        'totalDeployments24h': total_deployments_24h,
        'totalDeployments7d': total_deployments_7d,
        'servicesWithErrors': len([s for s in services if s['errors']['last7d'] > 0])
    }

    with open(meta_path, 'w') as f:
        json.dump(meta, f, indent=2)
    print(f"  Guardado: {meta_path}")

    print("\nActualización completada!")
    print(f"  Errores últimas 24h: {total_errors_24h}")
    print(f"  Errores últimos 7 días: {total_errors_7d}")
    print(f"  Despliegues últimas 24h: {total_deployments_24h}")
    print(f"  Despliegues últimos 7 días: {total_deployments_7d}")

if __name__ == '__main__':
    main()
