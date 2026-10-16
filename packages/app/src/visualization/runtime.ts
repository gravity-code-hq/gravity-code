import type { IconNode } from "lucide-react-native";

export interface VisualizationLabels {
  previous: string;
  next: string;
  controls: string;
}

interface SliderOptions {
  label: string;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}

interface TweakOptions {
  container: HTMLElement;
  onChange: () => void;
}

export function installVisualizationRuntime(
  icons: Record<string, IconNode>,
  labels: VisualizationLabels,
): void {
  function createIcons(options?: { attrs?: Record<string, string | number> }): void {
    for (const placeholder of document.querySelectorAll<HTMLElement>(
      "i[data-lucide], span[data-lucide]",
    )) {
      const name = placeholder.dataset.lucide ?? "";
      const key = name.replace(/(^|-)([a-z])/g, (_match, _separator: string, letter: string) =>
        letter.toUpperCase(),
      );
      const nodes = icons[key];
      if (!nodes) continue;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const attributes = {
        width: 16,
        height: 16,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": 2,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "aria-hidden": "true",
        ...options?.attrs,
      };
      for (const [attribute, value] of Object.entries(attributes))
        svg.setAttribute(attribute, String(value));
      svg.setAttribute("class", placeholder.className);
      for (const [tag, values] of nodes) {
        const child = document.createElementNS("http://www.w3.org/2000/svg", tag);
        for (const [attribute, value] of Object.entries(values)) {
          if (attribute !== "key") child.setAttribute(attribute, String(value));
        }
        svg.append(child);
      }
      placeholder.replaceWith(svg);
    }
  }

  // This bridge is local to the preview. It exposes no Gravity APIs or parent access.
  let widgetState: unknown = null;
  const openai = {
    get widgetState(): unknown {
      return widgetState;
    },
    async setWidgetState(state: unknown): Promise<void> {
      const serialized = JSON.stringify(state);
      if (serialized.length > 16_384) throw new RangeError("Widget state exceeds 16 KiB");
      widgetState = JSON.parse(serialized);
    },
  };

  class Tweak {
    private readonly panel: HTMLDetailsElement;
    private readonly onChange: () => void;

    constructor(options: TweakOptions) {
      this.panel = document.createElement("details");
      this.panel.className = "gravity-viz-controls";
      const summary = document.createElement("summary");
      summary.textContent = labels.controls;
      this.panel.append(summary);
      options.container.append(this.panel);
      this.onChange = options.onChange;
    }

    addSlider(target: Record<string, number>, key: string, options: SliderOptions): void {
      const label = document.createElement("label");
      const caption = document.createElement("span");
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(options.min);
      input.max = String(options.max);
      input.step = String(options.step ?? 1);
      input.value = String(target[key]);
      const update = () => {
        caption.textContent = `${options.label}: ${input.value}${options.unit ?? ""}`;
      };
      update();
      input.addEventListener("input", () => {
        target[key] = Number(input.value);
        update();
        this.onChange();
      });
      label.append(caption, input);
      this.panel.append(label);
    }
  }

  function installCarousel(carousel: HTMLElement): void {
    const variants = Array.from(carousel.querySelectorAll<HTMLElement>(":scope > [data-variant]"));
    if (variants.length === 0) return;
    let selected = 0;
    const navigation = document.createElement("nav");
    navigation.className = "gravity-viz-navigation";
    const previous = document.createElement("button");
    previous.type = "button";
    previous.textContent = "‹";
    previous.setAttribute("aria-label", labels.previous);
    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "›";
    next.setAttribute("aria-label", labels.next);
    const select = document.createElement("select");
    variants.forEach((variant, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = `${index + 1} / ${variants.length} ${variant.dataset.variant}`;
      select.append(option);
    });
    function update(): void {
      variants.forEach((variant, index) => {
        variant.hidden = index !== selected;
      });
      select.value = String(selected);
      previous.disabled = selected === 0;
      next.disabled = selected === variants.length - 1;
    }
    previous.addEventListener("click", () => {
      selected--;
      update();
    });
    next.addEventListener("click", () => {
      selected++;
      update();
    });
    select.addEventListener("change", () => {
      selected = Number(select.value);
      update();
    });
    navigation.append(previous, select, next);
    carousel.append(navigation);
    update();
  }

  Object.assign(window, { openai, lucide: { createIcons }, Tweak });
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      document.querySelectorAll<HTMLElement>(".viz-carousel").forEach(installCarousel);
      createIcons();
      new MutationObserver(() => createIcons()).observe(document.body, {
        childList: true,
        subtree: true,
      });
    },
    { once: true },
  );
}
