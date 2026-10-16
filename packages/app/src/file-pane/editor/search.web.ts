import { EditorSelection } from "@codemirror/state";
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  search,
  searchKeymap,
  SearchQuery,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";
import { EditorView, keymap, runScopeHandlers, type Panel } from "@codemirror/view";
import { i18n } from "@/i18n/i18next";
import type { Theme } from "@/styles/theme";

export function editorSearch() {
  return [
    search({ top: true, literal: true, createPanel: createFindPanel }),
    keymap.of(searchKeymap),
  ];
}

function createFindPanel(view: EditorView): Panel {
  const doc = view.dom.ownerDocument;
  const dom = doc.createElement("div");
  dom.className = "gravity-find";
  const row = doc.createElement("div");
  row.className = "gravity-find-row";
  const field = doc.createElement("div");
  field.className = "gravity-find-field";
  const input = doc.createElement("input");
  input.setAttribute("main-field", "true");
  input.autocomplete = "off";
  input.spellcheck = false;
  const replacement = doc.createElement("input");
  replacement.autocomplete = "off";
  replacement.spellcheck = false;
  const status = doc.createElement("span");
  status.className = "gravity-find-count";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const replaceRow = doc.createElement("div");
  replaceRow.className = "gravity-find-row gravity-find-replace";
  replaceRow.hidden = true;
  let query = getSearchQuery(view.state);
  let matches: { from: number; to: number }[] = [];
  let limitHit = false;

  function button(label: string, icon: string, action: () => void) {
    const control = doc.createElement("button");
    control.type = "button";
    control.title = label;
    control.setAttribute("aria-label", label);
    const path = FIND_ICONS[icon];
    if (path) {
      const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("width", "16");
      svg.setAttribute("height", "16");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "1.5");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.setAttribute("aria-hidden", "true");
      const shape = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      shape.setAttribute("d", path);
      svg.append(shape);
      control.append(svg);
    } else {
      control.textContent = icon;
    }
    control.addEventListener("click", action);
    return control;
  }

  function commit() {
    const next = new SearchQuery({ ...query, search: input.value, replace: replacement.value });
    const searchChanged = next.search !== query.search;
    view.dispatch({ effects: setSearchQuery.of(next) });
    if (searchChanged) revealMatch();
  }

  function revealMatch() {
    if (!query.valid) return;
    const cursor = query.getCursor(view.state, view.state.selection.main.from);
    let match = cursor.next();
    if (match.done) match = query.getCursor(view.state).next();
    if (match.done) return;
    const { from, to } = match.value;
    view.dispatch({
      selection: EditorSelection.single(from, to),
      effects: EditorView.scrollIntoView(from, { y: "center" }),
      userEvent: "select.search",
    });
  }

  function option(key: "caseSensitive" | "wholeWord" | "regexp", label: string, icon: string) {
    const control = button(label, icon, () => {
      view.dispatch({
        effects: setSearchQuery.of(new SearchQuery({ ...query, [key]: !query[key] })),
      });
      revealMatch();
      input.focus();
    });
    control.dataset.option = key;
    return control;
  }

  const t = i18n.getFixedT(null, "translation", "panels.file.editor.find");
  input.placeholder = t("placeholder");
  input.setAttribute("aria-label", t("placeholder"));
  replacement.placeholder = t("replace");
  replacement.setAttribute("aria-label", t("replace"));
  const toggle = button(t("toggleReplace"), "›", () => {
    replaceRow.hidden = !replaceRow.hidden;
    toggle.style.transform = replaceRow.hidden ? "" : "rotate(90deg)";
    toggle.setAttribute("aria-expanded", String(!replaceRow.hidden));
  });
  toggle.setAttribute("aria-expanded", "false");
  toggle.hidden = view.state.readOnly;
  const caseButton = option("caseSensitive", i18n.t("panels.search.options.caseSensitive"), "Aa");
  const wordButton = option("wholeWord", i18n.t("panels.search.options.wholeWord"), "ab");
  wordButton.style.textDecoration = "underline";
  const regexButton = option("regexp", i18n.t("panels.search.options.regex"), ".*");
  const previous = button(t("previous"), "↑", () => {
    findPrevious(view);
  });
  const next = button(t("next"), "↓", () => {
    findNext(view);
  });
  const all = button(t("selectAll"), "≡", () => {
    if (selectMatches(view)) view.focus();
  });
  const close = button(t("close"), "×", () => {
    closeSearchPanel(view);
    view.focus();
  });
  const replace = button(t("replace"), t("replace"), () => {
    replaceNext(view);
  });
  const replaceEvery = button(t("replaceAll"), t("replaceAll"), () => {
    replaceAll(view);
  });
  close.className = "gravity-find-close";
  field.append(input, caseButton, wordButton, regexButton);
  row.append(toggle, field, status, previous, next, all, close);
  replaceRow.append(replacement, replace, replaceEvery);
  dom.append(row, replaceRow);
  input.addEventListener("input", commit);
  replacement.addEventListener("input", commit);
  dom.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (runScopeHandlers(view, event, "search-panel")) {
      event.preventDefault();
      event.stopPropagation();
    } else if (event.key === "Enter" && (event.target === input || event.target === replacement)) {
      event.preventDefault();
      if (event.target === replacement) replaceNext(view);
      else if (event.target === input) (event.shiftKey ? findPrevious : findNext)(view);
    }
  });

  function refresh(recount: boolean) {
    query = getSearchQuery(view.state);
    if (input.value !== query.search) input.value = query.search;
    if (replacement.value !== query.replace) replacement.value = query.replace;
    caseButton.setAttribute("aria-pressed", String(query.caseSensitive));
    wordButton.setAttribute("aria-pressed", String(query.wholeWord));
    regexButton.setAttribute("aria-pressed", String(query.regexp));
    const invalid = query.search.length > 0 && !query.valid;
    input.setAttribute("aria-invalid", String(invalid));
    field.classList.toggle("gravity-find-invalid", invalid);
    if (recount) {
      matches = [];
      limitHit = false;
      if (query.valid) {
        const cursor = query.getCursor(view.state);
        for (let match = cursor.next(); !match.done; match = cursor.next()) {
          if (matches.length === 10000) {
            limitHit = true;
            break;
          }
          matches.push(match.value);
        }
      }
    }
    const selection = view.state.selection.main;
    const index = matches.findIndex(
      (match) => match.from === selection.from && match.to === selection.to,
    );
    const total = `${matches.length}${limitHit ? "+" : ""}`;
    let label = t("count", { current: index < 0 ? "–" : index + 1, total });
    if (!query.search) label = "";
    else if (invalid) label = t("invalidRegex");
    else if (!matches.length) label = t("noResults");
    status.textContent = label;
    status.title = label;
    status.classList.toggle("gravity-find-error", invalid || (query.valid && !matches.length));
    for (const control of [previous, next, all, replace, replaceEvery]) {
      control.disabled = !query.valid || matches.length === 0;
    }
  }

  refresh(true);
  return {
    dom,
    top: true,
    mount() {
      input.focus();
      input.select();
    },
    update(update) {
      const changed = !getSearchQuery(update.state).eq(query);
      if (changed || update.docChanged || update.selectionSet)
        refresh(changed || update.docChanged);
    },
  };
}

export function editorSearchTheme(theme: Theme) {
  return EditorView.theme({
    "&": { containerType: "inline-size", containerName: "gravity-editor" },
    ".cm-panels-top": {
      position: "absolute",
      marginTop: `${theme.spacing[2]}px`,
      left: "auto",
      right: `${theme.spacing[3]}px`,
      maxWidth: `calc(100% - ${theme.spacing[4]}px)`,
      zIndex: "10",
      border: "none",
      background: "transparent",
    },
    ".gravity-find": {
      width: "540px",
      maxWidth: "100%",
      boxSizing: "border-box",
      padding: `${theme.spacing[1]}px`,
      backgroundColor: theme.colors.surface1,
      color: theme.colors.foreground,
      border: `1px solid ${theme.colors.border}`,
      borderRadius: `${theme.borderRadius.md}px`,
      fontFamily: theme.fontFamily.ui,
      fontSize: `${theme.fontSize.sm}px`,
    },
    ".gravity-find-row": { display: "flex", alignItems: "center", gap: "2px", minWidth: "0" },
    "@container gravity-editor (max-width: 480px)": {
      ".gravity-find-row:first-child": {
        display: "grid",
        gridTemplateColumns: "28px minmax(0, 1fr) repeat(4, 28px)",
      },
      ".gravity-find-field": { gridColumn: "2 / -2", gridRow: "1" },
      ".gravity-find-close": { gridColumn: "-2 / -1", gridRow: "1" },
      ".gravity-find-count": { gridColumn: "2", width: "auto" },
    },
    ".gravity-find [hidden]": { display: "none" },
    ".gravity-find-field": {
      display: "flex",
      alignItems: "center",
      flex: "1",
      minWidth: "80px",
      border: `1px solid ${theme.colors.border}`,
      borderRadius: `${theme.borderRadius.sm}px`,
      backgroundColor: theme.colors.surface0,
      paddingRight: "2px",
    },
    ".gravity-find-field:focus-within": { borderColor: theme.colors.accent },
    ".gravity-find input": {
      width: "100%",
      minWidth: "0",
      boxSizing: "border-box",
      height: "28px",
      padding: `0 ${theme.spacing[2]}px`,
      border: "none",
      outline: "none",
      background: "transparent",
      color: "inherit",
      font: "inherit",
    },
    ".gravity-find input::placeholder": { color: theme.colors.foregroundMuted },
    ".gravity-find button": {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: "0",
      height: "28px",
      minWidth: "28px",
      padding: `0 ${theme.spacing[1]}px`,
      border: "1px solid transparent",
      borderRadius: `${theme.borderRadius.sm}px`,
      background: "transparent",
      color: theme.colors.foregroundMuted,
      font: "inherit",
      cursor: "pointer",
    },
    ".gravity-find button:hover, .gravity-find button[aria-pressed=true]": {
      backgroundColor: theme.colors.interactionHighlight,
      color: theme.colors.foreground,
    },
    ".gravity-find button[aria-pressed=true]": { borderColor: theme.colors.accent },
    ".gravity-find button:focus-visible": {
      outline: `1px solid ${theme.colors.accent}`,
      outlineOffset: "-1px",
    },
    ".gravity-find button:disabled": { opacity: "0.4", cursor: "default" },
    ".gravity-find-count": {
      width: "72px",
      padding: `0 ${theme.spacing[1]}px`,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      flexShrink: "1",
      color: theme.colors.foregroundMuted,
    },
    ".gravity-find-replace": { marginTop: `${theme.spacing[1]}px`, paddingLeft: "30px" },
    ".gravity-find-replace input": {
      border: `1px solid ${theme.colors.border}`,
      backgroundColor: theme.colors.surface0,
    },
    ".gravity-find-replace input:focus": { borderColor: theme.colors.accent },
    ".gravity-find .gravity-find-invalid": { borderColor: theme.colors.destructive },
    ".gravity-find .gravity-find-error": { color: theme.colors.destructive },
    ".cm-searchMatch": {
      backgroundColor: theme.colors.interactionHighlight,
      outline: `1px solid ${theme.colors.border}`,
    },
    ".cm-searchMatch-selected": {
      backgroundColor: theme.colors.terminal.selectionBackground,
      outline: `1px solid ${theme.colors.accent}`,
    },
  });
}

const FIND_ICONS: Record<string, string> = {
  "›": "m9 6 6 6-6 6",
  "↑": "M12 19V5m-6 6 6-6 6 6",
  "↓": "M12 5v14m-6-6 6 6 6-6",
  "×": "m6 6 12 12M6 18 18 6",
  "≡": "M4 6h16M4 12h16M4 18h10",
};
