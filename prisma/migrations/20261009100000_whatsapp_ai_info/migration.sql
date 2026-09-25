-- Avisos de WhatsApp que no son urgentes: solo en la campana (sin push ni correo).
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'WHATSAPP_AI_INFO';
