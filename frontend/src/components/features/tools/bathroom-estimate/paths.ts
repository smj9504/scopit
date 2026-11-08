/** Where the Bathroom Estimator's pages live in the app. */
export const BATHROOM_TOOL_PATH = '/app/tools/bathroom_estimate';
export const bathroomEstimatePath = (id: string) => `${BATHROOM_TOOL_PATH}/${id}`;
/** The product library, shared with the Cabinet Estimator; Back returns here. */
export const BATHROOM_PRODUCT_LIBRARY_PATH = `${BATHROOM_TOOL_PATH}/products`;
/** The company's bathroom prices (unit prices over the defaults). */
export const BATHROOM_PRICES_PATH = `${BATHROOM_TOOL_PATH}/prices`;
