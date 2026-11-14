/** @type {AppTypes.Config} */
/**
 * Stage-1 autonomous Orbital3D Viewer profile.
 * Local DICOM + optional S3 path load for speed tests.
 * Compressed HOT contract v1; CRM resolver is used only by /v/:token.
 */
window.config = {
  name: 'config/standalone.js',
  routerBasename: '/3dviewer/',
  // Stage-1 flags consumed by Local / TokenViewer
  standaloneMode: true,
  // Move the crosshair on the first gesture, even in an inactive pane.
  activateViewportBeforeInteraction: false,
  hideCloudStorage: false,
  disableTokenViewer: false,
  viewerIntegration: {
    resolveUrl: 'https://admin.orbital3d.ru/api/viewer/resolve/{token}',
  },
  extensions: [],
  modes: [],
  customizationService: {},
  investigationalUseDialog: {
    option: 'never',
  },
  // Keep true: root Local route is registered when showStudyList is true
  showStudyList: true,
  maxNumberOfWebWorkers: 3,
  showWarningMessageForCrossOrigin: true,
  showCPUFallbackMessage: true,
  showLoadingIndicator: true,
  experimentalStudyBrowserSort: false,
  strictZSpacingForVolumeViewport: true,
  groupEnabledModesFirst: true,
  allowMultiSelectExport: false,
  maxNumRequests: {
    interaction: 8,
    thumbnail: 2,
    prefetch: 6,
  },
  // Runtime S3 settings (keys preferably via session modal, not source).
  // Bound real SDK transfers, not just metadata-indexing workers.
  s3: {
    endpoint: 'https://storage.yandexcloud.net',
    bucket: 'orbital3d-hot-storage',
    region: 'ru-central1',
    concurrency: 8,
    downloadConcurrency: 8,
    processConcurrency: 4,
    metadataTimeoutMs: 20000,
    compressedOnly: true,
  },
  showErrorDetails: 'always',
  defaultDataSourceName: 'dicomlocal',
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomlocal',
      sourceName: 'dicomlocal',
      configuration: {
        friendlyName: 'dicom local',
      },
    },
  ],
  httpErrorHandler: error => {
    console.warn('[standalone] httpErrorHandler', error?.status);
  },
  // Resolve logo against PUBLIC_URL (release path), not site root /
  whiteLabeling: {
    createLogoComponentFn: function (React) {
      const base = (window.PUBLIC_URL || '/').replace(/\/?$/, '/');
      return React.createElement('img', {
        src: base + 'assets/custom-logo.png',
        alt: 'Logo',
        style: { height: '32px' },
      });
    },
  },
};
