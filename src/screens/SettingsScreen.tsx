import { EmptyState } from '../shared/ui/EmptyState';
export function SettingsScreen() {
  return (
    <>
      <header>
        <p className="eyebrow">Make yourself comfortable</p>
        <h1>Settings</h1>
      </header>
      <EmptyState title="Reading preferences are coming">
        Reading direction, fit mode, and a Reduced Motion override are planned.
        The shell currently follows your system motion preference.
      </EmptyState>
    </>
  );
}
