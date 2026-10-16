import { useEffect, useState } from "react";
import { openCreateCommandForm } from "./create-command-model";

export function useCreateCommandForm(create: Parameters<typeof openCreateCommandForm>[0]) {
  const [model] = useState(() => openCreateCommandForm(create));
  useEffect(() => () => model.close(), [model]);
  return model;
}
