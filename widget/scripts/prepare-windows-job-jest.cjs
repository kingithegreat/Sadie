'use strict';
// Also covers direct `npx jest --config=jest.config.ts` before any Vite build.
module.exports = async function prepareProductAssets() {
  require('./prepare-windows-job.cjs').prepareWindowsJob();
};
