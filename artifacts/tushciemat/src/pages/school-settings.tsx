import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetDashboardQueryKey, getGetSchoolSettingsQueryKey, getListDiscoverableSchoolsQueryKey,
  useGetSchoolSettings, useUpdateSchoolSettings, type School,
} from '@workspace/api-client-react';
import { AppShell, Button, ErrorState, LoadingBlock, PageHeader } from '@/components/shell';
import { apiMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import { SchoolMetadataFields, readSchoolFields } from '@/pages/onboarding';

export function SchoolSettingsPage() {
  const { school } = useSession();
  const settings = useGetSchoolSettings({ query: { enabled: !!school } });
  return <AppShell title="School settings" portal="admin"><main className="page">
    <PageHeader kicker="SCHOOL WORKSPACE" title="School settings" description="Keep your school information up to date and choose whether it appears in the public directory." />
    {settings.isLoading ? <LoadingBlock label="Loading school settings" /> : settings.isError || !settings.data ? <ErrorState message={apiMessage(settings.error, 'School settings could not be loaded.')} retry={() => { void settings.refetch(); }} /> : <SchoolSettingsForm key={settings.data.id} school={settings.data} />}
  </main></AppShell>;
}

function SchoolSettingsForm({ school }: { school: School }) {
  const update = useUpdateSchoolSettings(); const client = useQueryClient(); const { refreshMe } = useSession();
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice(''); setSaving(true);
    const data = readSchoolFields(new FormData(event.currentTarget));
    try {
      await update.mutateAsync({ data }); setNotice('School settings saved.');
      await Promise.all([
        client.invalidateQueries({ queryKey: getGetSchoolSettingsQueryKey() }),
        client.invalidateQueries({ queryKey: getGetDashboardQueryKey() }),
        client.invalidateQueries({ queryKey: getListDiscoverableSchoolsQueryKey() }),
        refreshMe(),
      ]);
    } catch (e) { setError(apiMessage(e, 'School settings could not be saved.')); }
    finally { setSaving(false); }
  }
  return <form className="panel onboarding-form settings-form" onSubmit={submit}>
    <div className="form-title"><h2>School details</h2><p>Required fields are marked with an asterisk.</p></div>
    <SchoolMetadataFields school={school} />
    <p className="muted-note">Verification status: <b>{school.verificationStatus}</b>. Verification is managed by the platform and cannot be changed here.</p>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-success" role="status">{notice}</p>}
    <Button type="submit" disabled={update.isPending || saving}>{saving ? 'Saving changes…' : 'Save changes'}</Button>
  </form>;
}
