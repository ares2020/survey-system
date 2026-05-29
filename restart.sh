#!/bin/bash
cd /root/survey-system
export DATA_DIR=/root/survey-system/data
node index.js &
echo "Started with PID: $!"
