import { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine, placeholder as cmPlaceholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion, closeBrackets } from '@codemirror/autocomplete';
import { linter, lintKeymap, type Diagnostic } from '@codemirror/lint';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { yaml } from '@codemirror/lang-yaml';
import { editorTheme } from './theme';
import { wikilinkCompletion } from './wikilinkCompletion';

interface Props {
  initial: string;
  dark: boolean;
  lint: (text: string) => Diagnostic[] | Promise<Diagnostic[]>;
  onChange: (text: string) => void;
  onSave: () => void;
}

/** CodeMirror 6 markdown editor. The view is created once; theme and lint are swapped via compartments. */
export function CodeEditor({ initial, dark, lint, onChange, onSave }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());
  const lintCompartment = useRef(new Compartment());
  const lintRef = useRef(lint);
  const saveRef = useRef(onSave);
  const changeRef = useRef(onChange);
  lintRef.current = lint;
  saveRef.current = onSave;
  changeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: initial,
      extensions: [
        history(),
        drawSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        closeBrackets(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, codeLanguages: [{ name: 'yaml', support: yaml() }] as never }),
        autocompletion({ override: [wikilinkCompletion()], activateOnTyping: true, icons: false }),
        lintCompartment.current.of(linter(view => lintRef.current(view.state.doc.toString()), { delay: 400 })),
        themeCompartment.current.of(editorTheme(dark)),
        cmPlaceholder('在这里书写 Markdown。输入 [[ 可以补全页面链接。'),
        keymap.of([
          { key: 'Mod-s', run: () => { saveRef.current(); return true; } },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...lintKeymap,
        ]),
        EditorView.updateListener.of(update => {
          if (update.docChanged) changeRef.current(update.state.doc.toString());
        }),
      ],
    });
    const view = new EditorView({ state, parent: host.current });
    viewRef.current = view;
    view.focus();
    return () => { view.destroy(); viewRef.current = null; };
    // The document is intentionally only read on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: themeCompartment.current.reconfigure(editorTheme(dark)) });
  }, [dark]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: lintCompartment.current.reconfigure(linter(view => lintRef.current(view.state.doc.toString()), { delay: 400 })) });
  }, [lint]);

  return <div ref={host} className="editor-pane" style={{ height: '100%' }} />;
}
