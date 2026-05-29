#!/bin/bash
export DATA_DIR="/root/survey-system/data"
export NODE_ENV="production"
export PORT="3001"

cd /root/survey-system
exec node index.js
