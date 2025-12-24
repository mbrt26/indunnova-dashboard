#!/usr/bin/env python3
"""
Script para consolidar errores sin crear issues.
Uso para ejecucion manual cuando no se quieren crear issues automaticamente.
"""

import json
import os
import sys

# Add scripts directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from consolidate_errors import consolidate_errors

def main():
    data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')

    errors_file = os.path.join(data_dir, 'errors.json')
    if not os.path.exists(errors_file):
        print("No errors.json found")
        return

    with open(errors_file, 'r') as f:
        errors = json.load(f)

    consolidated = consolidate_errors(errors)

    with open(os.path.join(data_dir, 'consolidated_errors.json'), 'w') as f:
        json.dump(consolidated, f, indent=2)

    print(f'Consolidated {len(errors)} errors into {len(consolidated)} groups')

if __name__ == '__main__':
    main()
