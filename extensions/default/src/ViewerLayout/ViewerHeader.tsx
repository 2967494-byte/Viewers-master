import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Button, Header, Icons, useModal } from '@ohif/ui-next';
import { useSystem } from '@ohif/core';
import { Toolbar } from '../Toolbar/Toolbar';
import HeaderPatientInfo from './HeaderPatientInfo';
import { PatientInfoVisibility } from './HeaderPatientInfo/HeaderPatientInfo';
import { preserveQueryParameters } from '@ohif/app';
import { Types } from '@ohif/core';
import LoadingProgressBar from './LoadingProgressBar';
import DentalPanoramaButton from './DentalPanoramaButton';
import DentalToolsToolbar from './DentalToolsToolbar';
import RenderingModeControl from './RenderingModeControl';
import { returnToPatientCard } from '@ohif/core/src/constants/orbitalPatientReturn';

function ViewerHeader({
  appConfig,
  showPrimaryToolbar = true,
  showHeaderUndoRedo = true,
  showHeaderPatientInfo = true,
  showHeaderMenu = true,
}: withAppTypes<{
  appConfig: AppTypes.Config;
  showPrimaryToolbar?: boolean;
  showHeaderUndoRedo?: boolean;
  showHeaderPatientInfo?: boolean;
  showHeaderMenu?: boolean;
}>) {
  const { servicesManager, extensionManager, commandsManager } = useSystem();
  const { customizationService, viewportGridService } = servicesManager.services;
  const [hasAxialViewport, setHasAxialViewport] = useState(false);
  useEffect(() => {
    const update = () =>
      setHasAxialViewport(viewportGridService.getState().viewports.has('mpr-axial'));
    const subscriptions = [
      viewportGridService.EVENTS.GRID_STATE_CHANGED,
      viewportGridService.EVENTS.VIEWPORTS_READY,
    ].map(event => viewportGridService.subscribe(event, update));
    update();
    return () => subscriptions.forEach(subscription => subscription.unsubscribe());
  }, [viewportGridService]);

  const navigate = useNavigate();
  const location = useLocation();

  const onClickReturnButton = () => {
    if (returnToPatientCard()) return;
    const { pathname } = location;
    const dataSourceIdx = pathname.indexOf('/', 1);

    const dataSourceName = pathname.substring(dataSourceIdx + 1);
    const existingDataSource = extensionManager.getDataSources(dataSourceName);

    const searchQuery = new URLSearchParams();
    if (dataSourceIdx !== -1 && existingDataSource) {
      searchQuery.append('datasources', pathname.substring(dataSourceIdx + 1));
    }
    preserveQueryParameters(searchQuery);

    navigate({
      pathname: '/',
      search: decodeURIComponent(searchQuery.toString()),
    });
  };

  const { t } = useTranslation();
  const { show } = useModal();

  const AboutModal = customizationService.getCustomization(
    'ohif.aboutModal'
  ) as Types.MenuComponentCustomization;

  const UserPreferencesModal = customizationService.getCustomization(
    'ohif.userPreferencesModal'
  ) as Types.MenuComponentCustomization;

  const menuOptions = showHeaderMenu
    ? [
        {
          title: AboutModal?.menuTitle ?? t('Header:About'),
          icon: 'info',
          onClick: () =>
            show({
              content: AboutModal,
              title: AboutModal?.title ?? t('AboutModal:About OHIF Viewer'),
              containerClassName: AboutModal?.containerClassName ?? 'max-w-md',
            }),
        },
        {
          title: UserPreferencesModal.menuTitle ?? t('Header:Preferences'),
          icon: 'settings',
          onClick: () =>
            show({
              content: UserPreferencesModal,
              title: UserPreferencesModal.title ?? t('UserPreferencesModal:User preferences'),
              containerClassName:
                UserPreferencesModal?.containerClassName ?? 'flex max-w-4xl p-6 flex-col',
            }),
        },
      ]
    : [];

  if (showHeaderMenu && appConfig.oidc) {
    menuOptions.push({
      title: t('Header:Logout'),
      icon: 'power-off',
      onClick: async () => {
        navigate(`/logout?redirect_uri=${encodeURIComponent(window.location.href)}`);
      },
    });
  }

  return (
    <>
      <Header
        className="orbital-viewer-header"
        menuOptions={menuOptions}
        isReturnEnabled={!!appConfig.showStudyList}
        onClickReturnButton={onClickReturnButton}
        WhiteLabeling={appConfig.whiteLabeling}
        FullHeightTools={
          <div className="flex h-full items-center">
            {hasAxialViewport && <DentalToolsToolbar commandsManager={commandsManager} />}
            {hasAxialViewport && <RenderingModeControl />}
            <div
              id="orbital-panorama-header-slot"
              className="flex h-full"
            >
              {hasAxialViewport && (
                <>
                  <DentalPanoramaButton
                    onClick={() => commandsManager.run('generateDentalPanorama')}
                  />
                  <DentalPanoramaButton
                    automatic
                    onClick={() => commandsManager.run('generateAutomaticDentalPanorama')}
                  />
                </>
              )}
            </div>
          </div>
        }
        Secondary={
          <div className="flex items-center gap-2">
            <Toolbar buttonSection="secondary" />
          </div>
        }
        PatientInfo={
          showHeaderPatientInfo &&
          appConfig.showPatientInfo !== PatientInfoVisibility.DISABLED && (
            <HeaderPatientInfo
              servicesManager={servicesManager}
              appConfig={appConfig}
            />
          )
        }
        UndoRedo={
          showHeaderUndoRedo ? (
            <div className="text-primary flex cursor-pointer items-center">
              <Button
                variant="ghost"
                className="hover:bg-primary-dark"
                onClick={() => {
                  commandsManager.run('undo');
                }}
              >
                <Icons.Undo className="" />
              </Button>
              <Button
                variant="ghost"
                className="hover:bg-primary-dark"
                onClick={() => {
                  commandsManager.run('redo');
                }}
              >
                <Icons.Redo className="" />
              </Button>
            </div>
          ) : null
        }
      >
        {showPrimaryToolbar && (
          <div className="relative flex justify-center gap-[4px]">
            <Toolbar buttonSection="primary" />
          </div>
        )}
      </Header>
      <LoadingProgressBar />
    </>
  );
}

export default ViewerHeader;
