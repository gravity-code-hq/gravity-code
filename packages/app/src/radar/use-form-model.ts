import { useEffect, useState } from "react";
import { openRadarForm, type RadarFormModel, type RadarFormSnapshot } from "./form-model";

/**
 * One model per mount, built from the snapshot at open. Later project-list
 * churn is piped in as an explicit input instead of rebuilding the model.
 */
export function useRadarFormModel(snapshot: RadarFormSnapshot): RadarFormModel {
  const [model] = useState(() => openRadarForm(snapshot));

  useEffect(() => {
    return () => {
      model.close();
    };
  }, [model]);

  useEffect(() => {
    model.applyProjectTargets(snapshot.projectTargets);
  }, [model, snapshot.projectTargets]);

  return model;
}
