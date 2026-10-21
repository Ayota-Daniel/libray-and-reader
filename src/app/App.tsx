import { useCallback, useEffect, useState } from 'react';
import { libraryApi as defaultLibraryApi } from '../shared/ipc/library';
import type { LibraryApi } from '../features/library/model';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { failure } from '../shared/ipc/errors';
import { useReader } from '../features/reader/useReader';
import type { ReaderApi } from '../features/reader/model';
import { HomeScreen } from '../screens/HomeScreen';
import { LibraryScreen } from '../screens/LibraryScreen';
import { ReaderScreen } from '../screens/ReaderScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

type Screen = 'Home' | 'Library' | 'Reader' | 'Settings';
const navigation: Screen[] = ['Home', 'Library', 'Reader', 'Settings'];

export function App({
  readerApi,
  libraryApi = defaultLibraryApi,
}: {
  readerApi?: ReaderApi;
  libraryApi?: LibraryApi;
}) {
  const reader = useReader(readerApi);
  const [screen, setScreen] = useState<Screen>('Home');
  const [closeError, setCloseError] = useState<string | null>(null);
  const flush = useCallback(
    () => reader.controller.progress.flush(),
    [reader.controller],
  );
  const open = async (id: string) => {
    await reader.controller.open(id);
    const state = reader.controller.getSnapshot();
    if (state.error) throw state.error;
    if (state.book?.libraryBookId === id) setScreen('Reader');
  };
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    const subscription = getCurrentWindow().onCloseRequested(async (event) => {
      if (!active) {
        event.preventDefault();
        return;
      }
      try {
        await reader.controller.prepareShutdown();
      } catch (error) {
        event.preventDefault();
        setCloseError(failure(error).message);
      }
    });
    void subscription.catch((error) => {
      if (active) setCloseError(failure(error).message);
    });
    return () => {
      active = false;
      void subscription.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [reader.controller]);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <aside>
        <div className="brand">
          Manga Reader<span>Desktop · V0.5</span>
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
        {closeError && <p role="alert">{closeError}</p>}
        {screen === 'Reader' ? (
          <ReaderScreen reader={reader} />
        ) : screen === 'Home' ? (
          <HomeScreen api={libraryApi} open={open} beforeRefresh={flush} />
        ) : screen === 'Library' ? (
          <LibraryScreen api={libraryApi} open={open} beforeRefresh={flush} />
        ) : (
          <SettingsScreen />
        )}
      </main>
    </div>
  );
}
