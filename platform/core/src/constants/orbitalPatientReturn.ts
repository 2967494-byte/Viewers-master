// Per-tab, in-memory launch context. Never reuse another study's card on manual loads.
let patientReturnUrl: string | null = null;

export function patientCardReturnUrl(prefix: string, resolveUrl: string, baseUrl: string): string | null {
  const appointment = prefix.match(/(?:^|\/)appt_([1-9]\d*)(?:_[\w-]+)?(?:\/|$)/i)?.[1]
    ?? prefix.match(/^hot\/([1-9]\d*)\//)?.[1];
  if (!appointment) return null;
  try {
    const crm = new URL(resolveUrl, baseUrl);
    if (!['http:', 'https:'].includes(crm.protocol)) return null;
    // This existing CRM route checks access and redirects to the linked patient card.
    return new URL(`/patients/visit/${appointment}`, crm.origin).href;
  } catch {
    return null;
  }
}

export function setPatientReturnUrl(url: string | null) {
  patientReturnUrl = url;
}

export function returnToPatientCard(assign = (url: string) => window.location.assign(url)): boolean {
  if (!patientReturnUrl) return false;
  assign(patientReturnUrl);
  return true;
}
