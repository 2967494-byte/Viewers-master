// External

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import PropTypes from 'prop-types';
import i18n from '@ohif/i18n';
import { I18nextProvider } from 'react-i18next';
import { BrowserRouter, type BrowserRouterProps } from 'react-router-dom';

import Compose from './routes/Mode/Compose';
import {
  ExtensionManager,
  CommandsManager,
  HotkeysManager,
  ServiceProvidersManager,
  SystemContextProvider,
  ViewportRefsProvider,
} from '@ohif/core';
import {
  ThemeWrapper as ThemeWrapperNext,
  NotificationProvider,
  ViewportGridProvider,
  DialogProvider,
  CineProvider,
  TooltipProvider,
  Modal as ModalNext,
  ManagedDialog,
  ModalProvider,
  ViewportDialogProvider,
  UserAuthenticationProvider,
} from '@ohif/ui-next';
// Viewer Project
// TODO: Should this influence study list?
import { AppConfigProvider } from '@state';
import createRoutes from './routes';
import appInit from './appInit.js';
import OpenIdConnectRoutes from './utils/OpenIdConnectRoutes';
import { ShepherdJourneyProvider } from 'react-shepherd';
import './App.css';
import StudyLoadingScreen from './components/StudyLoadingScreen/StudyLoadingScreen';
import {
  checkVolumeRenderingSupport,
  WEBGL2_HELP,
  WEBGL2_UNAVAILABLE,
} from './utils/volumeRenderingSupport';
import {
  getGraphicsError,
  subscribeGraphicsError,
} from '@ohif/core/src/constants/orbitalRendering';
import { initializeAutomaticGpuProfile } from '@ohif/core/src/constants/orbitalGpuProfile';
import { startViewerOpenTelemetry, getViewerOpenTracker, reportViewerProfile } from '@ohif/core/src/constants/orbitalOpenTelemetry';

let commandsManager: CommandsManager,
  extensionManager: ExtensionManager,
  servicesManager: AppTypes.ServicesManager,
  serviceProvidersManager: ServiceProvidersManager,
  hotkeysManager: HotkeysManager;

const routerFutureFlags: BrowserRouterProps['future'] = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
};

function App({
  config = {
    /**
     * Relative route from domain root that OHIF instance is installed at.
     * For example:
     *
     * Hosted at: https://ohif.org/where-i-host-the/viewer/
     * Value: `/where-i-host-the/viewer/`
     * */
    routerBasename: '/',
    /**
     *
     */
    showLoadingIndicator: true,
    showStudyList: true,
    oidc: [],
    extensions: [],
  },
  defaultExtensions = [],
  defaultModes = [],
}) {
  const [init, setInit] = useState(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const graphicsError = useSyncExternalStore(
    subscribeGraphicsError,
    getGraphicsError,
    getGraphicsError
  );
  useEffect(() => {
    try {
      const match = window.location.pathname.match(/\/v\/([^/]+)\/?$/);
      if (match) startViewerOpenTelemetry(decodeURIComponent(match[1]));
    } catch { /* Optional statistics must never stop study access. */ }
    const unsubscribe = subscribeGraphicsError(() => {
      if (getGraphicsError() && getViewerOpenTracker()?.state.status !== 'error') getViewerOpenTracker()?.fail('graphics-error');
    });
    const run = async () => {
      const support = checkVolumeRenderingSupport();
      if (!support.supported) {
        getViewerOpenTracker()?.fail(support.reason);
        setStartupError(
          support.reason === 'webgl2-unavailable'
            ? WEBGL2_UNAVAILABLE
            : 'Браузер предоставляет WebGL 2, но не смог создать графический ресурс для отображения исследования.'
        );
        return;
      }
      try {
        initializeAutomaticGpuProfile(support.gpuDevice);
        reportViewerProfile(support.gpuDevice);
        const initialized = await appInit(config, defaultExtensions, defaultModes);
        initialized.appConfig.max3DTextureSize = support.max3DTextureSize;
        setInit(initialized);
      } catch (error) {
        getViewerOpenTracker()?.fail('startup-error');
        console.error(error);
        setStartupError(
          'Не удалось запустить просмотрщик. Откройте исследование заново из личного кабинета.'
        );
      }
    };

    run();
    return unsubscribe;
  }, []);

  if (startupError || graphicsError) {
    return (
      <StudyLoadingScreen
        accessGranted={false}
        progress={{ text: '', percent: 0 }}
        error={startupError || graphicsError}
        errorTitle="Не удалось открыть исследование"
        errorIntro={
          graphicsError
            ? 'Во время отображения произошёл сбой графики. Подробности приведены ниже.'
            : WEBGL2_HELP
        }
        backLabel={startupError ? 'Проверить снова' : 'Вернуться в личный кабинет'}
        onBack={() => (startupError ? window.location.reload() : window.location.assign('/'))}
      />
    );
  }

  if (!init) {
    return (
      <StudyLoadingScreen
        accessGranted={false}
        progress={{ text: '', percent: 0 }}
        onBack={() => {}}
      />
    );
  }

  // Set above for named export
  commandsManager = init.commandsManager;
  extensionManager = init.extensionManager;
  servicesManager = init.servicesManager;
  serviceProvidersManager = init.serviceProvidersManager;
  hotkeysManager = init.hotkeysManager;

  // Set appConfig
  const appConfigState = init.appConfig;
  const { routerBasename, modes, dataSources, oidc, showStudyList } = appConfigState;

  const {
    uiDialogService,
    uiModalService,
    uiViewportDialogService,
    viewportGridService,
    cineService,
    userAuthenticationService,
    uiNotificationService,
    customizationService,
  } = servicesManager.services;

  const providers = [
    [AppConfigProvider, { value: appConfigState }],
    [UserAuthenticationProvider, { service: userAuthenticationService }],
    [I18nextProvider, { i18n }],
    [ThemeWrapperNext],
    [SystemContextProvider, { commandsManager, extensionManager, hotkeysManager, servicesManager }],
    [ViewportRefsProvider],
    [ViewportGridProvider, { service: viewportGridService }],
    [ViewportDialogProvider, { service: uiViewportDialogService }],
    [CineProvider, { service: cineService }],
    [NotificationProvider, { service: uiNotificationService }],
    [TooltipProvider],
    [DialogProvider, { service: uiDialogService, dialog: ManagedDialog }],
    [ModalProvider, { service: uiModalService, modal: ModalNext }],
    [ShepherdJourneyProvider],
  ];

  // Loop through and register each of the service providers registered with the ServiceProvidersManager.
  const providersFromManager = Object.entries(serviceProvidersManager.providers);
  if (providersFromManager.length > 0) {
    providersFromManager.forEach(([serviceName, provider]) => {
      providers.push([provider, { service: servicesManager.services[serviceName] }]);
    });
  }

  const CombinedProviders = ({ children }) => Compose({ components: providers, children });

  let authRoutes = null;

  // Should there be a generic call to init on the extension manager?
  customizationService.init(extensionManager);

  // Use config to create routes
  const appRoutes = createRoutes({
    modes,
    dataSources,
    extensionManager,
    servicesManager,
    commandsManager,
    hotkeysManager,
    routerBasename,
    showStudyList,
  });

  if (oidc) {
    authRoutes = (
      <OpenIdConnectRoutes
        oidc={oidc}
        routerBasename={routerBasename}
        userAuthenticationService={userAuthenticationService}
      />
    );
  }

  return (
    <CombinedProviders>
      <BrowserRouter
        basename={routerBasename}
        future={routerFutureFlags}
      >
        {authRoutes}
        {appRoutes}
      </BrowserRouter>
    </CombinedProviders>
  );
}

App.propTypes = {
  config: PropTypes.oneOfType([
    PropTypes.func,
    PropTypes.shape({
      routerBasename: PropTypes.string.isRequired,
      oidc: PropTypes.array,
      whiteLabeling: PropTypes.object,
      extensions: PropTypes.array,
    }),
  ]).isRequired,
  /* Extensions that are "bundled" or "baked-in" to the application.
   * These would be provided at build time as part of they entry point. */
  defaultExtensions: PropTypes.array,
  /* Modes that are "bundled" or "baked-in" to the application.
   * These would be provided at build time as part of they entry point. */
  defaultModes: PropTypes.array,
};

export default App;

export { commandsManager, extensionManager, servicesManager };
