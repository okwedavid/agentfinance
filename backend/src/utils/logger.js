import fs from 'fs';
import path from 'path';
import winston from 'winston';

const defaultDir = process.platform === 'win32'
  ? path.join(process.cwd(), 'logs')
  : '/var/log';

let fileTransport = null;

try {
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
  }
  fileTransport = new winston.transports.File({
    filename: path.join(defaultDir, 'agentfinance.log'),
    level: 'info',
  });
} catch {
  fileTransport = null;
}

const transports = [new winston.transports.Console()];
if (fileTransport) transports.push(fileTransport);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`),
  ),
  transports,
});

export default logger;
