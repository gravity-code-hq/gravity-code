import { useMemo, type ReactElement } from "react";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import {
  SelectField,
  type SelectFieldDisplay,
  type SelectFieldOption,
} from "@/components/ui/select-field";
import { findScheduleTemplate, SCHEDULE_TEMPLATES } from "@gravity/protocol/schedule/templates";

interface ScheduleTemplateFieldProps {
  selectedTemplateId: string;
  onSelect: (templateId: string) => void;
  size: FieldControlSize;
}

const TEMPLATE_OPTIONS: SelectFieldOption<string>[] = SCHEDULE_TEMPLATES.map((template) => ({
  id: template.id,
  value: template.id,
  label: template.label,
  description: template.description,
  testID: `schedule-template-option-${template.id}`,
}));

export function ScheduleTemplateField({
  selectedTemplateId,
  onSelect,
  size,
}: ScheduleTemplateFieldProps): ReactElement {
  const selectedDisplay = useMemo<SelectFieldDisplay | null>(() => {
    const template = findScheduleTemplate(selectedTemplateId);
    return template ? { label: template.label } : null;
  }, [selectedTemplateId]);

  return (
    <SelectField
      label="Template"
      value={selectedTemplateId || null}
      selectedDisplay={selectedDisplay}
      options={TEMPLATE_OPTIONS}
      onChange={onSelect}
      placeholder="Start from a template"
      emptyText="No templates"
      searchable={false}
      title="Template"
      size={size}
      hint="Fills in the name, prompt, and cadence. Edit anything after."
      triggerTestID="schedule-template-trigger"
    />
  );
}
