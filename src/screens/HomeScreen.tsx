import { EmptyState } from '../shared/ui/EmptyState';
export function HomeScreen() {
  return (
    <>
      <header>
        <p className="eyebrow">A quiet place to read</p>
        <h1>Home</h1>
        <p>Pick up where you left off.</p>
      </header>
      <EmptyState title="Your next chapter starts here">
        Open a local CBZ from Reader. Continue Reading and recent activity are
        not available yet.
      </EmptyState>
    </>
  );
}
