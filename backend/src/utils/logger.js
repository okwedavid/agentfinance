import winston from 'winston';
import fs from 'fs';

const logDir = '/var/log';
try { if (!fs.existsSync(logDir)) fs.mkdirSync(logDir); } catch (e) { /* ignore on container restrictions */ }

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: '/var/log/agentfinance.log', level: 'info' })
  ],
});

export default logger;
