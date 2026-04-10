import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const pinKeys = {
  all: (wsId: string) => ["pins", wsId] as const,
  list: (wsId: string) => [...pinKeys.all(wsId), "list"] as const,
};

export function pinListOptions(wsId: string) {
  return queryOptions({
    queryKey: pinKeys.list(wsId),
    queryFn: () => api.listPins(),
  });
}
