import { useCallback, useMemo, useSyncExternalStore, type ReactElement } from "react";
import { Text, View } from "react-native";
import { Folder } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { ComboboxItem } from "@/components/ui/combobox";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField, type SelectFieldRenderOptionInput } from "@/components/ui/select-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useProjects } from "@/hooks/use-projects";
import type { RadarFormRecord, RadarFormSubmission } from "@/radar/form-model";
import { useRadarFormModel } from "@/radar/use-form-model";
import { useRadarMutations } from "@/radar/use-mutations";
import { buildScheduleProjectTargets } from "@/schedules/schedule-project-targets";

// A Slack channel reference, not copy: it reads the same in every locale.
const CHANNEL_PLACEHOLDER = "#alerts";

interface RadarFormSheetProps {
  serverId: string;
  /** The radar to edit, or null to create one. */
  radar: RadarFormRecord | null;
  onClose: () => void;
}

/**
 * Mounted only while open, with a key per radar, so every open builds a fresh
 * model. See docs/forms.md.
 */
export function RadarFormSheet({ serverId, radar, onClose }: RadarFormSheetProps): ReactElement {
  const { t } = useTranslation();
  const size: FieldControlSize = useIsCompactFormFactor() ? "md" : "sm";
  const { projects } = useProjects();
  const projectTargets = useMemo(() => buildScheduleProjectTargets(projects), [projects]);
  const model = useRadarFormModel({ serverId, radar, projectTargets });
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const { createRadar, updateRadar } = useRadarMutations(serverId);

  const close = useCallback(() => {
    if (!state.pending) {
      onClose();
    }
  }, [onClose, state.pending]);

  const submit = useCallback(() => {
    void model.submit(async (submission: RadarFormSubmission) => {
      if (submission.kind === "create") {
        await createRadar(submission.input);
      } else {
        await updateRadar(submission.input);
      }
      onClose();
    });
  }, [createRadar, model, onClose, updateRadar]);

  const header = useMemo<SheetHeader>(
    () => ({ title: radar ? t("radar.form.editTitle") : t("radar.form.createTitle") }),
    [radar, t],
  );

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button
          style={styles.footerButton}
          variant="secondary"
          onPress={close}
          disabled={state.pending}
          testID="radar-form-cancel"
        >
          {t("radar.form.cancel")}
        </Button>
        <Button
          style={styles.footerButton}
          variant="default"
          onPress={submit}
          disabled={!state.canSubmit}
          loading={state.pending}
          testID="radar-form-submit"
        >
          {radar ? t("radar.form.save") : t("radar.form.create")}
        </Button>
      </View>
    ),
    [close, radar, state.canSubmit, state.pending, submit, t],
  );

  return (
    <AdaptiveModalSheet
      visible
      header={header}
      onClose={close}
      footer={footer}
      testID="radar-form-sheet"
    >
      <SelectField
        label={t("radar.form.project")}
        value={state.selectedProjectOptionId}
        selectedDisplay={state.projectDisplay}
        options={state.projectOptions}
        onChange={model.setProject}
        placeholder={t("radar.form.projectPlaceholder")}
        emptyText={t("radar.form.projectEmpty")}
        disabled={state.pending}
        searchable
        searchPlaceholder={t("radar.form.projectSearchPlaceholder")}
        title={t("radar.form.projectPlaceholder")}
        size={size}
        triggerTestID="radar-project-trigger"
        renderOption={renderProjectOption}
      />

      <Field
        label={t("radar.form.channel")}
        hint={t("radar.form.channelHint")}
        error={state.isChannelInvalid ? t("radar.form.channelInvalid") : null}
        testID="radar-channel-field"
      >
        <FormTextInput
          size={size}
          testID="radar-channel-input"
          accessibilityLabel={t("radar.form.channel")}
          initialValue={state.channel}
          onChangeText={model.setChannel}
          placeholder={CHANNEL_PLACEHOLDER}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!state.pending}
        />
      </Field>

      <Field label={t("radar.form.instructions")}>
        <FormTextInput
          size={size}
          testID="radar-instructions-input"
          accessibilityLabel={t("radar.form.instructions")}
          initialValue={state.instructions}
          onChangeText={model.setInstructions}
          placeholder={t("radar.form.instructionsPlaceholder")}
          style={styles.multilineInput}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          editable={!state.pending}
        />
      </Field>

      {state.submitError ? (
        <Text style={styles.submitError} accessibilityRole="alert" testID="radar-form-error">
          {state.submitError}
        </Text>
      ) : null}
    </AdaptiveModalSheet>
  );
}

function renderProjectOption(input: SelectFieldRenderOptionInput<string>): ReactElement {
  return <ProjectOptionItem {...input} />;
}

function ProjectOptionItem({
  option,
  selected,
  active,
  onPress,
}: SelectFieldRenderOptionInput<string>): ReactElement {
  const leadingSlot = useMemo(
    () => (
      <View style={styles.optionIconBox}>
        <Folder size={16} color={styles.optionIcon.color} />
      </View>
    ),
    [],
  );

  return (
    <ComboboxItem
      testID={option.testID}
      label={option.label}
      selected={selected}
      active={active}
      onPress={onPress}
      leadingSlot={leadingSlot}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  multilineInput: {
    minHeight: 96,
  },
  optionIconBox: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  // Static color holder for the lucide icon; keeps the muted token without useUnistyles.
  optionIcon: {
    color: theme.colors.foregroundMuted,
  },
  footer: {
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  footerButton: {
    flex: 1,
  },
  submitError: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
}));
