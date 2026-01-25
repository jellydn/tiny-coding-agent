/**
 * Plugin Signature Verification
 *
 * Provides simple HMAC-SHA256 based signing and verification for plugins.
 * Uses Node.js built-in crypto module - no additional dependencies.
 *
 * Signature format:
 * ```json
 * {
 *   "plugin": "plugin-name",
 *   "version": "1.0.0",
 *   "author": "author@example.com",
 *   "timestamp": "2026-01-25T00:00:00.000Z",
 *   "fingerprint": "sha256:abc123...",
 *   "signature": "hex-encoded-hmac"
 * }
 * ```
 *
 * Key distribution:
 * - Public key stored in ~/.tiny-agent/keys/public.pem
 * - Private key for signing plugins (kept secret by plugin authors)
 * - System-wide trusted keys in ~/.tiny-agent/keys/trusted/
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Plugin signature data
 */
export interface PluginSignature {
  /** Plugin name */
  plugin: string;
  /** Plugin version */
  version: string;
  /** Plugin author email or identifier */
  author: string;
  /** ISO timestamp of signature */
  timestamp: string;
  /** SHA-256 hash of plugin content */
  fingerprint: string;
  /** HMAC-SHA256 signature */
  signature: string;
  /** Key identifier (which key was used for signing) */
  keyId?: string;
}

/**
 * Verification result
 */
export interface VerificationResult {
  /** Whether the signature is valid */
  valid: boolean;
  /** Reason for verification failure */
  reason?: string;
  /** Plugin information from signature */
  info?: {
    plugin: string;
    version: string;
    author: string;
    timestamp: string;
  };
}

/**
 * Get the keys directory
 */
async function getKeysDir(): Promise<string> {
  const keysDir = path.join(os.homedir(), ".tiny-agent", "keys");
  await fs.mkdir(keysDir, { recursive: true });
  return keysDir;
}

/**
 * Generate a new key pair for plugin signing
 *
 * @returns Object containing publicKey, privateKey, and keyId
 */
export async function generateKeyPair(): Promise<{
  publicKey: string;
  privateKey: string;
  keyId: string;
}> {
  const keysDir = await getKeysDir();
  const keyId = `key-${Date.now()}`;

  // Generate HMAC key (we use a simple secret key for HMAC)
  const secretKey = crypto.randomBytes(32).toString("hex");
  const publicKey = Buffer.from(secretKey).toString("base64");

  // Store public key
  const publicKeyPath = path.join(keysDir, `${keyId}.pub`);
  await fs.writeFile(publicKeyPath, `${keyId}:${publicKey}\n`, { mode: 0o600 });

  return {
    publicKey,
    privateKey: secretKey,
    keyId,
  };
}

/**
 * Load a trusted public key by key ID
 */
export async function loadPublicKey(keyId: string): Promise<string | null> {
  const keysDir = await getKeysDir();
  const publicKeyPath = path.join(keysDir, `${keyId}.pub`);

  try {
    const content = await fs.readFile(publicKeyPath, "utf-8");
    const [id, key] = content.split(":");
    if (id === keyId && key) {
      return key;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Load all trusted public keys
 */
export async function loadTrustedKeys(): Promise<Map<string, string>> {
  const keysDir = await getKeysDir();
  const keys = new Map<string, string>();

  try {
    const files = await fs.readdir(keysDir);
    for (const file of files) {
      if (file.endsWith(".pub")) {
        const content = await fs.readFile(path.join(keysDir, file), "utf-8");
        const [id, key] = content.split(":");
        if (id && key) {
          keys.set(id, key);
        }
      }
    }
  } catch {
    // Directory doesn't exist yet
  }

  return keys;
}

/**
 * Calculate content fingerprint (SHA-256 hash)
 */
export function calculateFingerprint(content: string): string {
  return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
}

/**
 * Sign a plugin
 *
 * @param pluginName - Name of the plugin
 * @param version - Plugin version
 * @param author - Plugin author
 * @param content - Full plugin content
 * @param privateKey - Secret key for signing
 * @param keyId - Key identifier
 * @returns Plugin signature object
 */
export function signPlugin(
  pluginName: string,
  version: string,
  author: string,
  content: string,
  privateKey: string,
  keyId?: string,
): PluginSignature {
  const timestamp = new Date().toISOString();
  const fingerprint = calculateFingerprint(content);

  // Create payload to sign
  const payload = `${pluginName}:${version}:${author}:${timestamp}:${fingerprint}`;

  // Generate HMAC-SHA256 signature
  const hmac = crypto.createHmac("sha256", privateKey);
  hmac.update(payload);
  const signature = hmac.digest("hex");

  return {
    plugin: pluginName,
    version,
    author,
    timestamp,
    fingerprint,
    signature,
    keyId,
  };
}

/**
 * Verify a plugin signature
 *
 * @param signature - Plugin signature to verify
 * @param content - Plugin content to verify against
 * @returns Verification result
 */
export async function verifyPluginSignature(
  signature: PluginSignature,
  content: string,
): Promise<VerificationResult> {
  // Check that content fingerprint matches
  const expectedFingerprint = calculateFingerprint(content);
  if (signature.fingerprint !== expectedFingerprint) {
    return {
      valid: false,
      reason: "Content fingerprint mismatch - plugin has been modified",
    };
  }

  // Load the public key
  let publicKey: string | null;

  if (signature.keyId) {
    publicKey = await loadPublicKey(signature.keyId);
  } else {
    // Try all trusted keys
    const trustedKeys = await loadTrustedKeys();
    for (const [, key] of trustedKeys) {
      const result = verifyWithKey(signature, key, content);
      if (result.valid) {
        return result;
      }
    }
    return {
      valid: false,
      reason: "No valid signature found from trusted keys",
    };
  }

  if (!publicKey) {
    return {
      valid: false,
      reason: `Public key not found: ${signature.keyId ?? "unknown"}`,
    };
  }

  return verifyWithKey(signature, publicKey, content);
}

/**
 * Verify signature with a specific key
 */
function verifyWithKey(
  signature: PluginSignature,
  publicKey: string,
  _content: string,
): VerificationResult {
  // Recreate payload
  const payload = `${signature.plugin}:${signature.version}:${signature.author}:${signature.timestamp}:${signature.fingerprint}`;

  // Verify HMAC signature
  const hmac = crypto.createHmac("sha256", Buffer.from(publicKey, "base64"));
  hmac.update(payload);
  const expectedSignature = hmac.digest("hex");

  if (signature.signature !== expectedSignature) {
    return {
      valid: false,
      reason: "Invalid signature",
    };
  }

  // Check timestamp (signatures older than 1 year are suspicious)
  const signatureDate = new Date(signature.timestamp);
  const maxAge = 365 * 24 * 60 * 60 * 1000; // 1 year in ms
  const now = Date.now();

  if (now - signatureDate.getTime() > maxAge) {
    return {
      valid: false,
      reason: "Signature is too old (may be expired)",
    };
  }

  return {
    valid: true,
    info: {
      plugin: signature.plugin,
      version: signature.version,
      author: signature.author,
      timestamp: signature.timestamp,
    },
  };
}

/**
 * Parse signature from plugin frontmatter
 *
 * Looks for a `signature` field in the frontmatter that contains
 * a JSON string of the PluginSignature object.
 */
export function parseSignatureFromFrontmatter(
  frontmatter: Record<string, unknown>,
): PluginSignature | null {
  const signatureField = frontmatter.signature;

  if (!signatureField) {
    return null;
  }

  if (typeof signatureField === "string") {
    try {
      return JSON.parse(signatureField) as PluginSignature;
    } catch {
      return null;
    }
  }

  if (typeof signatureField === "object" && signatureField !== null) {
    return signatureField as PluginSignature;
  }

  return null;
}

/**
 * Create signature for inclusion in plugin frontmatter
 *
 * Returns a JSON string suitable for embedding in YAML frontmatter
 */
export function createSignatureFrontmatter(signature: PluginSignature): string {
  return JSON.stringify(signature);
}
