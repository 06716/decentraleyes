/**
 * State Manager
 * Belongs to Decentraleyes.
 *
 * @author      Thomas Rientjes
 * @since       2017-03-10
 * @license     MPL 2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/.
 */

'use strict';

/**
 * State Manager
 */

var stateManager = {};

/**
 * Constants
 */

const BLOCKING_ACTION = 'blocking';
const HOST_PREFIX = '*://';
const HOST_SUFFIX = '/*';
const REQUEST_HEADERS = 'requestHeaders';

/**
 * Public Methods
 */

stateManager.registerInjection = function (tabIdentifier, injection) {

    let injectionIdentifier, registeredTab, injectionCount;

    injectionIdentifier = injection.source + injection.path + injection.version;
    registeredTab = stateManager.tabs[tabIdentifier];

    registeredTab.injections[injectionIdentifier] = injection;
    injectionCount = Object.keys(registeredTab.injections).length || 0;

    if (stateManager.showIconBadge === true) {

        if (injectionCount > 0) {

            chrome.browserAction.setBadgeText({
                tabId: tabIdentifier,
                text: injectionCount.toString()
            });

        } else {

            chrome.browserAction.setBadgeText({
                tabId: tabIdentifier,
                text: ''
            });
        }
    }

    if (isNaN(interceptor.amountInjected)) {

        chrome.storage.local.get('amountInjected', function (items) {

            interceptor.amountInjected = items.amountInjected;

            chrome.storage.local.set({
                'amountInjected': ++interceptor.amountInjected
            });
        });

    } else {

        chrome.storage.local.set({
            'amountInjected': ++interceptor.amountInjected
        });
    }
};

stateManager.addDomainToWhitelist = function (domain) {

    return new Promise((resolve) => {

        let whitelistedDomains = requestAnalyzer.whitelistedDomains;
        whitelistedDomains[domain] = true;

        chrome.storage.local.set({whitelistedDomains}, resolve);
    });
};

stateManager.deleteDomainFromWhitelist = function (domain) {

    return new Promise((resolve) => {

        let whitelistedDomains = requestAnalyzer.whitelistedDomains;
        delete whitelistedDomains[domain];

        chrome.storage.local.set({whitelistedDomains}, resolve);
    });
};

/**
 * Private Methods
 */

stateManager._createTab = function (tab) {

    let tabIdentifier, requestFilters;

    tabIdentifier = tab.id;

    stateManager.tabs[tabIdentifier] = {
        'injections': {}
    };

    requestFilters = {

        'tabId': tabIdentifier,
        'urls': stateManager.validHosts
    };

    chrome.webRequest.onBeforeRequest.addListener(function (requestDetails) {
        return interceptor.handleRequest(requestDetails, tabIdentifier, tab);
    }, requestFilters, [BLOCKING_ACTION]);
};

stateManager._removeTab = function (tabIdentifier) {
    delete stateManager.tabs[tabIdentifier];
};

stateManager._updateTab = function (details) {

    let tabIdentifier, frameIdentifier;

    tabIdentifier = details.tabId;
    frameIdentifier = details.frameId;

    if (tabIdentifier === -1 || frameIdentifier !== 0) {
        return;
    }

    if (stateManager.showIconBadge === true) {

        chrome.browserAction.setBadgeText({
            tabId: tabIdentifier,
            text: ''
        });
    }

    if (stateManager.tabs[tabIdentifier]) {
        stateManager.tabs[tabIdentifier].injections = {};
    }
};

stateManager._stripMetadata = function (requestDetails) {

    for (let i = 0; i < requestDetails.requestHeaders.length; ++i) {

        if (requestDetails.requestHeaders[i].name === 'Origin') {
            requestDetails.requestHeaders.splice(i--, 1);
        } else if (requestDetails.requestHeaders[i].name === 'Referer') {
            requestDetails.requestHeaders.splice(i--, 1);
        }
    }

    return {
        'requestHeaders': requestDetails.requestHeaders
    };
};

stateManager._handleStorageChanged = function (changes) {

    if ('showIconBadge' in changes) {
        
        stateManager.showIconBadge = changes.showIconBadge.newValue;

        if (changes.showIconBadge.newValue !== true) {

            chrome.tabs.query({}, function (tabs) {
                tabs.forEach(stateManager._removeIconBadgeFromTab);
            });
        }
    }

    if ('stripMetadata' in changes) {

        let onBeforeSendHeaders;

        onBeforeSendHeaders = chrome.webRequest.onBeforeSendHeaders;

        onBeforeSendHeaders.removeListener(stateManager._stripMetadata, {
            'urls': stateManager.validHosts
        }, [BLOCKING_ACTION, REQUEST_HEADERS]);

        if (changes.stripMetadata.newValue !== false) {
            
            onBeforeSendHeaders.addListener(stateManager._stripMetadata, {
                'urls': stateManager.validHosts
            }, [BLOCKING_ACTION, REQUEST_HEADERS]);
        }
    }
};

stateManager._removeIconBadgeFromTab = function (tab) {

    chrome.browserAction.setBadgeText({
        tabId: tab.id,
        text: ''
    });
};

/**
 * Initializations
 */

stateManager.requests = {};
stateManager.tabs = {};
stateManager.validHosts = [];

for (let mapping in mappings) {

    if (!mappings.hasOwnProperty(mapping)) {
        continue;
    }

    let supportedHost = HOST_PREFIX + mapping + HOST_SUFFIX;
    stateManager.validHosts.push(supportedHost);
}

chrome.tabs.query({}, function (tabs) {
    tabs.forEach(stateManager._createTab);
});

chrome.storage.local.get('showIconBadge', function (items) {
    stateManager.showIconBadge = items.showIconBadge || true;
});

/**
 * Event Handlers
 */

chrome.tabs.onCreated.addListener(stateManager._createTab);
chrome.tabs.onRemoved.addListener(stateManager._removeTab);

chrome.webNavigation.onCommitted.addListener(stateManager._updateTab, {
    url: [{urlContains: ':'}]
});

chrome.webRequest.onErrorOccurred.addListener(function (requestDetails) {

    if (stateManager.requests[requestDetails.requestId]) {
        delete stateManager.requests[requestDetails.requestId];
    }

}, {'urls': ['*://*/*']});

chrome.webRequest.onBeforeRedirect.addListener(function (requestDetails) {

    let knownRequest = stateManager.requests[requestDetails.requestId];

    if (knownRequest) {

        stateManager.registerInjection(knownRequest.tabIdentifier, knownRequest.targetDetails);
        delete stateManager.requests[requestDetails.requestId];
    }

}, {'urls': ['*://*/*']});

chrome.webRequest.onBeforeSendHeaders.addListener(stateManager._stripMetadata, {
    'urls': stateManager.validHosts
}, [BLOCKING_ACTION, REQUEST_HEADERS]);

chrome.storage.onChanged.addListener(stateManager._handleStorageChanged);
