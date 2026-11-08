/** Where the Cabinet Estimator's pages live in the app. */
export const CABINET_TOOL_PATH = '/app/tools/cabinet_estimate';
export const cabinetEstimatePath = (id: string) => `${CABINET_TOOL_PATH}/${id}`;
export const PRODUCT_LIBRARY_PATH = `${CABINET_TOOL_PATH}/products`;
/** The company's cabinet prices (unit prices over the defaults). */
export const CABINET_PRICES_PATH = `${CABINET_TOOL_PATH}/prices`;
