/**
 * Primitivos de patrón del CRM.
 *
 * Cada uno existe porque el mismo problema estaba resuelto de tres, cuatro o
 * cinco maneras distintas por el panel. Las reglas que imponen están en
 * `docs/crm-ui-contract.md` y las comprueba `e2e/crm-contract.spec.ts`.
 *
 * Al migrar una sección: usar estos y borrar el markup a mano, no envolverlo.
 */

export { default as CrmPublicLink } from "./CrmPublicLink";
export { default as CrmEmptyState } from "./CrmEmptyState";
export { default as CrmLoadingState } from "./CrmLoadingState";
export { default as CrmErrorState } from "./CrmErrorState";
export {
  default as CrmDataList,
  CrmDataListRow,
  CrmDataListHeader,
} from "./CrmDataList";
export {
  default as CrmRowActions,
  CrmRowAction,
  CrmRowEdit,
  CrmRowDelete,
} from "./CrmRowActions";
export { default as CrmFormActions } from "./CrmFormActions";
export { default as CrmLoadMore } from "./CrmLoadMore";
export { default as CrmFilterBar, CrmSearchInput } from "./CrmFilterBar";
