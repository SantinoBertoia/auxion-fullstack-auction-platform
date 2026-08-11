const nodemailer = require('nodemailer');
const { env } = require('../config/env');

const SMTP_CONFIG_MESSAGE =
  'No se pudo enviar el email: usar MAIL_TRANSPORT=console en local o configurar RESEND_API_KEY, ' +
  'BREVO_API_KEY o las variables SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS y MAIL_FROM.';

const requiredConfig = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'];

const createConfigError = () => {
  const error = new Error(SMTP_CONFIG_MESSAGE);
  error.status = 503;
  error.code = 'SMTP_NOT_CONFIGURED';
  return error;
};

// ---------------------------------------------------------------------------
// Console transport. Used for local demos/tests only; it prints the full message
// so the evaluator can continue password reset or registration flows.
// ---------------------------------------------------------------------------

const sendViaConsole = async ({ to, subject, text }) => {
  console.info(
    [
      '',
      '[Auxion local email]',
      `To: ${to}`,
      `Subject: ${subject}`,
      '--- message ---',
      text,
      '--- end ---',
      '',
    ].join('\n')
  );
  return { accepted: [to], transport: 'console' };
};

// ---------------------------------------------------------------------------
// Resend (HTTPS API). Used when RESEND_API_KEY is configured.
// ---------------------------------------------------------------------------

// Resend no permite mandar "desde" gmail (no se controla el DNS de gmail.com).
// Orden de preferencia: RESEND_FROM > MAIL_FROM si no es gmail > dominio de
// prueba de Resend (onboarding@resend.dev). Con el dominio de prueba, Resend
// solo entrega a la direccion duenia de la cuenta; para mandar a cualquiera hay
// que verificar un dominio en resend.com/domains y setear RESEND_FROM/MAIL_FROM.
const resolveResendFrom = () => {
  if (env.RESEND_FROM) return env.RESEND_FROM;
  const from = env.MAIL_FROM;
  if (from && !/@gmail\.com/i.test(from)) return from;
  return 'Auxion <onboarding@resend.dev>';
};

const sendViaResend = async ({ to, subject, text, html }) => {
  let response;
  let data = {};
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: resolveResendFrom(), to, subject, text, html }),
    });
    data = await response.json().catch(() => ({}));
  } catch (error) {
    const networkError = new Error(`No se pudo contactar a Resend: ${error.message}`);
    networkError.status = 502;
    networkError.code = 'SMTP_SEND_FAILED';
    throw networkError;
  }

  if (!response.ok) {
    const emailError = new Error(`No se pudo enviar el email (Resend): ${data.message || response.status}`);
    emailError.status = 502;
    emailError.code = 'SMTP_SEND_FAILED';
    throw emailError;
  }

  return data;
};

// ---------------------------------------------------------------------------
// Brevo (HTTPS API). Used when BREVO_API_KEY is configured.
// ---------------------------------------------------------------------------

// Parsea "Nombre <email>" o "email" en { name, email } para el sender de Brevo.
const parseFromAddress = (raw) => {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(raw || '');
  if (match) {
    return { name: match[1] || 'Auxion', email: match[2].trim() };
  }
  const email = String(raw || '').trim();
  return { name: 'Auxion', email: email || 'auxion.app@gmail.com' };
};

const sendViaBrevo = async ({ to, subject, text, html }) => {
  const sender = parseFromAddress(env.MAIL_FROM);
  let response;
  let data = {};
  try {
    response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': env.BREVO_API_KEY,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender,
        to: [{ email: to }],
        subject,
        textContent: text,
        ...(html ? { htmlContent: html } : {}),
      }),
    });
    data = await response.json().catch(() => ({}));
  } catch (error) {
    const networkError = new Error(`No se pudo contactar a Brevo: ${error.message}`);
    networkError.status = 502;
    networkError.code = 'SMTP_SEND_FAILED';
    throw networkError;
  }

  if (!response.ok) {
    const emailError = new Error(`No se pudo enviar el email (Brevo): ${data.message || response.status}`);
    emailError.status = 502;
    emailError.code = 'SMTP_SEND_FAILED';
    throw emailError;
  }

  return data;
};

// ---------------------------------------------------------------------------
// SMTP (nodemailer). Fallback para desarrollo local, donde el SMTP saliente no
// esta bloqueado. Se usa cuando no hay BREVO_API_KEY ni RESEND_API_KEY.
// ---------------------------------------------------------------------------

const getSmtpConfig = () => {
  const missing = requiredConfig.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw createConfigError();
  }

  const port = Number(env.SMTP_PORT);
  if (!Number.isInteger(port) || port <= 0) {
    throw createConfigError();
  }

  return {
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
    from: env.MAIL_FROM,
  };
};

const sendViaSmtp = async ({ to, subject, text, html }) => {
  const config = getSmtpConfig();
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
  });

  try {
    return await transporter.sendMail({
      from: config.from,
      to,
      subject,
      text,
      html,
    });
  } catch (error) {
    const emailError = new Error(`No se pudo enviar el email real: ${error.message}`);
    emailError.status = 502;
    emailError.code = 'SMTP_SEND_FAILED';
    throw emailError;
  }
};

const requireProviderKey = (condition) => {
  if (!condition) throw createConfigError();
};

// Despacha por la via seleccionada. En desarrollo el default es console; en
// produccion el default es auto y no imprime tokens en logs.
const sendEmail = (payload) => {
  if (env.MAIL_TRANSPORT === 'console') return sendViaConsole(payload);
  if (env.MAIL_TRANSPORT === 'brevo') {
    requireProviderKey(env.BREVO_API_KEY);
    return sendViaBrevo(payload);
  }
  if (env.MAIL_TRANSPORT === 'resend') {
    requireProviderKey(env.RESEND_API_KEY);
    return sendViaResend(payload);
  }
  if (env.MAIL_TRANSPORT === 'smtp') return sendViaSmtp(payload);

  if (env.BREVO_API_KEY) return sendViaBrevo(payload);
  if (env.RESEND_API_KEY) return sendViaResend(payload);
  return sendViaSmtp(payload);
};

const firstName = (fullName) => String(fullName || '').trim().split(/\s+/)[0] || 'postor';

const sendPreRegistrationReceivedEmail = ({ to, nombre, reviewAvailableAt }) => {
  const name = firstName(nombre);
  const subject = 'Solicitud de preregistro recibida';
  const text = [
    `Hola ${name},`,
    '',
    'Recibimos correctamente tu solicitud de preregistro en Auxion.',
    'Tus datos quedan en proceso de verificacion por parte de la empresa.',
    reviewAvailableAt ? `La revision quedara disponible desde ${reviewAvailableAt}.` : '',
    'Vas a recibir otro email cuando puedas completar el registro.',
  ]
    .filter(Boolean)
    .join('\n');

  return sendEmail({ to, subject, text });
};

const sendPreRegistrationApprovedEmail = ({ to, nombre, categoria, tokenRegistro }) => {
  const name = firstName(nombre);
  const subject = 'Preregistro aprobado - completa tu registro';
  const text = [
    `Hola ${name},`,
    '',
    'Tu preregistro en Auxion fue aprobado.',
    `Categoria asignada: ${categoria}.`,
    `Codigo para completar registro: ${tokenRegistro}.`,
    '',
    'Ingresa a la app, selecciona "Completar registro" y genera tu clave personal.',
  ].join('\n');

  return sendEmail({ to, subject, text });
};

const sendPasswordResetEmail = ({ to, nombre, token, expiresAt }) => {
  const name = firstName(nombre);
  const subject = 'Recuperacion de contrasena - Auxion';
  const text = [
    `Hola ${name},`,
    '',
    'Se solicito recuperar la contrasena de tu cuenta en Auxion.',
    `Codigo de recuperacion: ${token}.`,
    expiresAt ? `Este codigo vence el ${expiresAt}.` : '',
    '',
    'Ingresa ese codigo en la app para crear una nueva contrasena.',
    'Si no solicitaste este cambio, ignora este correo.',
  ]
    .filter(Boolean)
    .join('\n');

  return sendEmail({ to, subject, text });
};

module.exports = {
  SMTP_CONFIG_MESSAGE,
  sendEmail,
  sendPreRegistrationReceivedEmail,
  sendPreRegistrationApprovedEmail,
  sendPasswordResetEmail,
};
