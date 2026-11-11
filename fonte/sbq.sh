#!/bin/bash
# Executa SQL no projeto: sbq.sh arquivo.sql  |  sbq.sh -c "select 1"
T=$(cat /home/claude/gastos/.sbtoken); REF=cjltedcpwmaqluvhybih
if [ "$1" = "-c" ]; then Q="$2"; else Q=$(cat "$1"); fi
python3 -c 'import json,sys; print(json.dumps({"query": sys.argv[1]}))' "$Q" > /tmp/claude-0/q.json
curl -s --max-time 120 -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $T" -H 'content-type: application/json' --data @/tmp/claude-0/q.json
echo
