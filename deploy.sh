#!/usr/bin/env bash
set -euo pipefail

EC2_IP="${EC2_IP:-18.234.138.97}"
KEY="${SSH_KEY:-$HOME/ada_lovelace.pem}"
REMOTE_DIR="/home/ec2-user/payroll-operations"

echo "=> Deploying payroll-operations to $EC2_IP ..."

# Create tar excluding unwanted dirs, upload and extract on server
tar cf - \
  --exclude='node_modules' \
  --exclude='.env' \
  --exclude='.git' \
  --exclude='.github' \
  --exclude='.claude' \
  . | ssh -i "$KEY" ec2-user@"$EC2_IP" "mkdir -p $REMOTE_DIR && cd $REMOTE_DIR && tar xf -"

ssh -i "$KEY" ec2-user@"$EC2_IP" << 'ENDSSH'
  cd /home/ec2-user/payroll-operations
  npm install --production
  chmod 600 .env 2>/dev/null || true
  sudo systemctl restart taon-payroll-operations.service
  sleep 3
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/)
  if [ "$STATUS" = "200" ]; then
    echo "OK - Payroll Operations rodando"
  else
    echo "ERRO - HTTP $STATUS"
    sudo journalctl -u taon-payroll-operations.service --no-pager -n 30
    exit 1
  fi
ENDSSH

echo "=> Deploy concluido!"
