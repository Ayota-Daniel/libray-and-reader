import { useState } from 'react';
import { useReader } from '../features/reader/useReader';
import type { ReaderApi } from '../features/reader/model';
import { HomeScreen } from '../screens/HomeScreen';
import { LibraryScreen } from '../screens/LibraryScreen';
import { ReaderScreen } from '../screens/ReaderScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

type Screen = 'Home' | 'Library' | 'Reader' | 'Settings';
const navigation: Screen[] = ['Home', 'Library', 'Reader', 'Settings'];

export function App({ readerApi }: { readerApi?: ReaderApi }) {
  const reader = useReader(readerApi);
  const [screen, setScreen] = useState<Screen>('Home');
  return (
    <div className="app-shell">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <aside>
        <div className="brand">
          Manga Reader<span>Desktop · V0.4</span>
        </div>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              key={item}
              aria-current={screen === item ? 'page' : undefined}
              onClick={() => setScreen(item)}
            >
              {item}
            </button>
          ))}
        </nav>
        <p className="sidebar-note">
          Your collection.
          <br />
          Your reading space.
        </p>
      </aside>
      <main id="content" tabIndex={-1}>
        {screen === 'Reader' ? (
          <ReaderScreen reader={reader} />
        ) : screen === 'Home' ? (
          <HomeScreen />
        ) : screen === 'Library' ? (
          <LibraryScreen />
        ) : (
          <SettingsScreen />
        )}
      </main>
    </div>
  );
}
