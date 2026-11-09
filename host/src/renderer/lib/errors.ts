/**
 * Friendly error handling.
 *
 * Raw errors from the backend are technical ("SQLITE_BUSY", "EADDRINUSE", stack traces). Beginners
 * need a plain explanation and a suggested fix; advanced users still need the original text. This
 * module maps a thrown value to both, and offers a copy-to-clipboard helper for the technical part.
 */

export interface FriendlyError {
  /** Plain-language summary safe to show to anyone. */
  title: string;
  /** What the user can do about it. */
  hint: string;
  /** Original message / stack for the "Copy technical details" button. */
  technical: string;
}

const RULES: { test: RegExp; title: string; hint: string }[] = [
  {
    test: /EADDRINUSE|address already in use/i,
    title: 'That network port is already in use',
    hint: 'Another program is using this port. Change the API port in Settings, or close the other program.',
  },
  {
    test: /ECONNREFUSED|fetch failed|socket hang up|network/i,
    title: 'Could not reach the server',
    hint: 'Check that the server address is correct and that the server is online, then try again.',
  },
  {
    test: /ENOTFOUND|getaddrinfo/i,
    title: 'That server address could not be found',
    hint: 'The address may be misspelled. Check the spelling in the server settings.',
  },
  {
    test: /ETIMEDOUT|timed out|timeout/i,
    title: 'The connection timed out',
    hint: 'The server took too long to respond. Try again, or raise the connection timeout in the server settings.',
  },
  {
    test: /no stored credential|credential/i,
    title: 'This account needs a password',
    hint: 'Open Accounts, select the account and store its password before starting it.',
  },
  {
    test: /already exists|duplicate/i,
    title: 'That already exists',
    hint: 'Use a different name, or edit the existing item instead of creating a new one.',
  },
  {
    test: /username is required|required/i,
    title: 'A required field is empty',
    hint: 'Fill in the highlighted field and try again.',
  },
  {
    test: /authoris|authoriz/i,
    title: 'Combat testing is not authorised',
    hint: 'Turn on "Authorise combat testing" for the account, or start it without combat.',
  },
  {
    test: /backend is not available|fleet backend/i,
    title: 'The app is not connected to its backend',
    hint: 'Launch the app through Electron rather than a plain browser window.',
  },
];

/** Maps any thrown value to a friendly title/hint plus the original technical text. */
export function toFriendlyError(error: unknown): FriendlyError {
  const technical = error instanceof Error
    ? `${error.name}: ${error.message}${error.stack ? `\n\n${error.stack}` : ''}`
    : typeof error === 'string' ? error : JSON.stringify(error, null, 2);

  const message = error instanceof Error ? error.message : String(error);
  for (const rule of RULES) {
    if (rule.test.test(message)) return { title: rule.title, hint: rule.hint, technical };
  }
  return {
    title: 'Something went wrong',
    hint: 'The action could not be completed. Copy the technical details if you need to investigate.',
    technical,
  };
}

/** Copies text to the clipboard, falling back to a hidden textarea on older engines. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
