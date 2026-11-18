import { patientCardReturnUrl, returnToPatientCard, setPatientReturnUrl } from './orbitalPatientReturn';

afterEach(() => setPatientReturnUrl(null));

it('returns to the authorized appointment card on the CRM origin, including extra studies', () => {
  expect(patientCardReturnUrl('hot/2026/11/18/pat_42/appt_65001/', 'https://admin.orbital3d.ru/api/viewer/resolve/{token}', 'https://viewer.example/3dviewer/'))
    .toBe('https://admin.orbital3d.ru/patients/visit/65001');
  expect(patientCardReturnUrl('hot/appt_65001/extra_7/', '/api/viewer/resolve/{token}', 'http://127.0.0.1:3010/3dviewer/'))
    .toBe('http://127.0.0.1:3010/patients/visit/65001');
  expect(patientCardReturnUrl('hot/65001/uuid_archive/', '/api/viewer/resolve/{token}', 'https://admin.orbital3d.ru'))
    .toBe('https://admin.orbital3d.ru/patients/visit/65001');
  expect(patientCardReturnUrl('hot/2026/11/18/pat_42/appt_65001_abc123/', '/api/viewer/resolve/{token}', 'https://admin.orbital3d.ru'))
    .toBe('https://admin.orbital3d.ru/patients/visit/65001');
});

it('does not invent a card for local/synthetic data or accept non-HTTP CRM URLs', () => {
  for (const prefix of ['hot/appt_large/', 'hot/appt_12x/', 'hot/appt_0/', 'hot/no-appointment/']) {
    expect(patientCardReturnUrl(prefix, '/api/viewer/resolve/{token}', 'https://admin.orbital3d.ru')).toBeNull();
  }
  expect(patientCardReturnUrl('hot/appt_1/', 'javascript:alert(1)', 'https://admin.orbital3d.ru')).toBeNull();
});

it('retains the current launch across SPA navigation and clears it for subsequent manual loading', () => {
  const assign = jest.fn();
  setPatientReturnUrl('https://admin.orbital3d.ru/patients/visit/1');
  expect(returnToPatientCard(assign)).toBe(true);
  setPatientReturnUrl('https://admin.orbital3d.ru/patients/visit/2');
  expect(returnToPatientCard(assign)).toBe(true);
  expect(assign.mock.calls.map(([url]) => url)).toEqual([
    'https://admin.orbital3d.ru/patients/visit/1', 'https://admin.orbital3d.ru/patients/visit/2',
  ]);
  setPatientReturnUrl(null);
  expect(returnToPatientCard(assign)).toBe(false);
  expect(assign).toHaveBeenCalledTimes(2);
});
