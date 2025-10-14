import Event from "sap/ui/base/Event";

type ParameterGetter<T> = (name: string) => T;

export function getEventParameter<T>(event: Event, parameterName: string): T | undefined {
  const getter = event.getParameter as unknown as ParameterGetter<T | undefined>;
  return getter.call(event, parameterName);
}
