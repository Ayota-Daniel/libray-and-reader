import { useState } from 'react';
import { HomeScreen } from '../screens/HomeScreen';
import { LibraryScreen } from '../screens/LibraryScreen';
import { ReaderScreen } from '../screens/ReaderScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

const screens = {
  Home: HomeScreen,
  Library: LibraryScreen,
  Reader: ReaderScreen,
  Settings: SettingsScreen,
};
type Screen = keyof typeof screens;
const navigation: Screen[] = ['Home', 'Library', 'Reader', 'Settings'];

export function App() {
  const [screen, setScreen] = useState<Screen>('Home');
  const ScreenContent = screens[screen];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <aside>
        <div className="brand">
          Manga Reader<span>Desktop · V0.1</span>
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
        <ScreenContent />
      </main>
    </div>
  );
}
