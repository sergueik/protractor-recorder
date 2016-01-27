(function () {
  'use strict';

  angular
      .module('protractorRec')
      .controller('MainController', MainController);

  /** @ngInject */
  function MainController($rootScope, $scope, $routeParams, $log, $filter, $timeout, $mdToast, $location, $mdDialog, $document, socket, protractorRecServer, seleniumJWP) {

    var vm = this;

    $log.debug($location.path());

    /*-------------------------------------------------------------------
     * 		 				 	ATTRIBUTES
     *-------------------------------------------------------------------*/

    vm.actionTypes = ['click', 'sendKeys', 'wait', 'browser'];

    vm.isSnippet           = false;
    vm.showSelectedOptions = false;
    vm.index = false;

    /* If first run set examples or get from local storage */
    vm.describes = localStorage.getItem('describes') ? angular.fromJson(localStorage.getItem('describes')) : [];
    vm.conf      = localStorage.getItem('conf') ? angular.fromJson(localStorage.getItem('conf')) : false;
    vm.session   = localStorage.getItem('session') ? angular.fromJson(localStorage.getItem('session')) : {};

    if(vm.session.id) {
      seleniumJWP.setSession(vm.session);
    }

    vm.lines         = [];
    vm.describe      = {};
    vm.spec          = [];
    vm.dataBind      = [];

    vm.selectedItems = 0;

    if($location.path() == '/conf') {

      vm.spec = vm.conf.spec;

    } else if($routeParams.id) {

      var index = parseInt($routeParams.id) - 1;
      vm.spec = vm.describes[0].specs[index];

    }



    /* Base options for new spec */
    vm.blankSpec = {
      string: '',
      actions: []
    };

    vm.hidden = false;
    vm.isOpen = false;
    vm.hover = false;

    // On opening, add a delayed property which shows tooltips after the speed dial has opened
    // so that they have the proper position; if closing, immediately hide the tooltips
    $scope.$watch('main.isOpen', function (isOpen) {
      if (isOpen) {
        $timeout(function () {
          vm.tooltipVisible = vm.isOpen;
        }, 600);
      } else {
        vm.tooltipVisible = vm.isOpen;
      }
    });

    /*-------------------------------------------------------------------
     * 		 				  BROADCAST MESSAGES
     *-------------------------------------------------------------------*/
    $scope.$on('conf', function(events, args) {
      vm.conf = args;
    });

    /*-------------------------------------------------------------------
     * 		 				  SOCKET ON
     *-------------------------------------------------------------------*/
    /**
     * Messages: onsnippet, click, change, keyup, assertion, session-disconnect, protractor-log
     */

    socket.on('onsnippet', function(){
       vm.isSnippet = true;
    });

    socket.on('click', function (data) {
      $log.debug('onclick');
      $log.debug(data);

      vm.setElement(data);

    });

    socket.on('change', function (data) {
      $log.debug('onchange');
      $log.debug(data);

      vm.setElementOnChange(data);

    });

    socket.on('keyup', function (data) {
      $log.debug('onkeyup');
      $log.debug(data);

      if(protractorRecServer.isRecording()) {
        var lastAction = vm.spec.actions[vm.spec.actions.length - 1];
        lastAction.action = 'sendKeys';
        lastAction.value = data;
      }

    });

    socket.on('assertion', function (data) {
      $log.debug('onassertion');
      $log.debug(data);

      if(protractorRecServer.isRecording() && data) {
        var lastAction = vm.spec.actions[vm.spec.actions.length - 1];

        lastAction.action = 'assertion';
        lastAction.value = data.trim();

        vm.dataBind.forEach(function (data) {

          lastAction.locators.push(data);

        });
      }

    });

    socket.on('session-disconnect', function (data) {

      seleniumJWP.getSessionUrl().success(function(response){

        if(vm.session.url != response.value && !vm.isSnippet) {

          protractorRecServer.setLoading(true);

          vm.getSessionSource();

        }

        vm.session.url = response.value;
      });

      //vm.isSnippet = false;


      $log.debug('on-session-disconnect');
      $log.debug(data);

    });

    socket.on('protractor-log', function (data) {
      $log.debug('protractor-log');
      $log.debug(data);
    });

    vm.setCapabilities = function(capability) {
      if(capability.checked){
        vm.conf.capabilities.push(capability.driver);
      } else {
        var index = vm.conf.capabilities.indexOf(capability.driver);
        vm.conf.capabilities.splice(index, 1);
      }
    };



    vm.newDescribe = function () {
      $log.debug('newDescribe');

    };

    vm.addSpec = function () {
      $log.debug('addSpec');

      vm.describe.specs.push(angular.copy(vm.blankSpec));
      vm.setSpec(vm.describe.specs[vm.describe.specs.length - 1]);
    };

    vm.setDescribe = function (describe) {
      vm.describe = describe;
    };

    vm.setElementOnChange = function (element) {

      if (protractorRecServer.isRecording()) {

        var target = angular.element(element.outerHTML);

        if (target[0].tagName.match(/^select/i) && element.value) {

          vm.addElement(target, 'select', 'click', element.value, element.xPath);
        }
      }
    };

    vm.setElement = function (element) {

      if(protractorRecServer.isRecording()) {
        var target = angular.element(element.outerHTML);
        var parent = !element.offsetParent.outerHTML ? [] : angular.element(element.offsetParent.outerHTML);

        var value = '';

        if (target[0].tagName.match(/^button/i) || (parent[0].tagName && parent[0].tagName.match(/^button/i)) && !target[0].tagName.match(/^input/i)) {

          vm.addElement(parent, 'button', 'click', target.text().trim(), element.xPath);

        } else if (target[0].tagName.match(/^input/i)) {
          vm.addElement(target, 'input', 'click', false, element.xPath);
        } else if (target[0].tagName.match(/^a/i)) {
          vm.addElement(target, 'a', 'click', target.text().trim(), element.xPath);
        } else if (element.ngRepeat) {

          value = target.text() ? target.text() : false;

          //if(value)
          vm.addElement(target, target[0].tagName.toLowerCase(), 'wait', value.trim(), element.xPath);

          vm.addElement(target, 'row', 'click', element.ngRepeat.rowIndex, element.xPath, element.ngRepeat.value);

          vm.addElement(target, target[0].tagName.toLowerCase(), 'click', value.trim(), element.xPath);

        } else if(!target[0].tagName.match(/^select/i)){
          value = target.text() ? target.text().trim() : false;
          vm.addElement(target, target[0].tagName.toLowerCase(), 'click', value, element.xPath);
        }
      }
    };

    vm.addElement = function (element, type, actionType, value, xPath, repeater) {

      var locators = [];

      if(type == 'select' && vm.getAttr('ng-model', element))
        locators.push({type: 'model', value: vm.getAttr('ng-model', element)});

      if(type == 'row')
        locators.push({type: 'repeater', value: repeater});

      if (type == 'button' && value)
        locators.push({type: 'buttonText', value: value});

      if (type == 'input' && vm.getAttr('ng-model', element))
        locators.push({type: 'model', value: vm.getAttr('ng-model', element)});

      if (type == 'input' && vm.getAttr('name', element))
        locators.push({type: 'css', value: '[name="' + vm.getAttr('name', element) + '"]', strategy: 'css selector'});

      /*if (type == 'input' && vm.getAttr('type', element) == 'button') {
        locators.push({type: 'id', value: vm.getAttr('id', element)});
      }*/

      if (type == 'input' && vm.getAttr('type', element) == 'submit')
        locators.push({type: 'css', value: '[value="' + element.val() + '"]', strategy: 'css selector'});

      if (vm.getAttr('href', element)) {
        locators.push({type: 'linkText', value: value, strategy: 'link text'});
        locators.push({type: 'get', value: vm.getAttr('href', element)});
      }

      if (vm.getAttr('id', element) && !element[0].tagName.match(/md/i))
        locators.push({type: 'id', value: vm.getAttr('id', element), strategy: 'id'});

      //if (vm.getAttr('class', element) || actionType == 'wait') {

        /*if (value && type != 'row')
          locators.push({type: 'xpath', value: '//' + type + '[.="' + value + '"]', strategy: 'xpath'});*/

        if (xPath && !vm.getAttr('ng-click', element) && !vm.getAttr('class', element))
          locators.push({type: 'xpath', value: xPath, strategy: 'xpath'});

        if (vm.getAttr('ng-click', element))
          locators.push({type: 'css', value: '[ng-click="' + vm.getAttr('ng-click', element) + '"]', strategy: 'css selector'})

        if (xPath)
          locators.push({type: 'xpath', value: xPath, strategy: 'xpath'});

        if(vm.getAttr('class', element))
          locators.push({type: 'css', value: '.' + vm.getAttr('class', element).replace(/\s/g, '.')});
      //}

      var action = {
        //element: element.html(),
        type: type,
        value: value,
        action: actionType,
        locators: locators,
        locator: locators ? {type: locators[0].type, value: locators[0].value} : null
      };

      vm.spec.actions.push(action);

      var mainContent = angular.element( $document[0].querySelector('#main') );
      mainContent[0].scrollTop = mainContent[0].scrollHeight;

      vm.getSessionUrl();

      //localStorage.setItem('actions', angular.toJson(vm.actions));

      //vm.getSessionUrl();

    };

    /**
     * Get all data bind to suggest on assertions
     */
    vm.getAllDataBind = function () {

      $log.debug('getAllDataBind');

      var dataBind = vm.session.source.match(/\{{2}(.*?)\}{2}|ng-bind=["|'](.*?)["|']/igm);

      angular.forEach(dataBind, function (data) {

        data = data.replace(/\"|\'|ng-bind=|{{|}}/g, '').trim();

        if (!$filter('filter')(vm.dataBind, data).length) {

          vm.dataBind.push({type: 'bind', value: data});

        }

      });

      $log.debug(dataBind);
      $log.debug(vm.dataBind);

    };

    vm.runTest = function () {

      $log.debug('runTest');

      protractorRecServer.runProtractor().success(function(response){
        $log.debug('Test finished');
        $log.debug(response);
      });
    };

    vm.removeSpec = function (index) {
      vm.describe.specs.splice(index, 1);
    };

    vm.exportProtractor = function () {

      $log.debug('exportProtractor');

      /* Get line to export actions in conf.js */
      vm.conf.spec.lines = [];

      angular.forEach(vm.conf.spec.actions, function (action) {

        if(action.breakpoint) {
          vm.conf.spec.lines('    browser.pause();');
        }

        vm.conf.spec.lines.push(vm.getLine(action));

      });

      /* Get line to export actions in spec.js */
      vm.spec.lines = [];

      if($filter('filter')(vm.spec.actions, {action: 'wait'}).length != 0)
        vm.spec.lines.push('    var EC = protractor.ExpectedConditions;');

      angular.forEach(vm.spec.actions, function (action) {

        if(action.breakpoint) {
          vm.spec.lines.push('browser.pause();');
        }

        vm.spec.lines.push(vm.getLine(action));

      });

      var data = {baseUrl: vm.url, conf: angular.toJson(vm.conf), describe: angular.toJson(vm.describes)};

      protractorRecServer.exportProtractor(data).success(function(response){
        $log.debug('Exported');
        $log.debug(response);

        $mdToast.show(
            $mdToast.simple()
                .content('File exported!')
                .position('bottom left')
                .hideDelay(3000)
        );
      });
    };

    vm.runFromHere = function(index) {

      vm.index = index;
      var element = vm.getElementAction(vm.spec.actions[index]);
      vm.getSessionElementId(element);

    };

    vm.setActionLocator = function(action){
      $log.debug(action);
    };

    vm.getAttr = function (attr, elem) {
      if (elem.attr(attr))
        return elem.attr(attr);
      return false;
    };

    vm.createSession = function () {

      if(!vm.session.id) {

        var options = {'desiredCapabilities': {'browserName': 'chrome', acceptSSlCerts: true}};

        seleniumJWP.newSession(options).success(function(response){
          $log.debug('Session Created');
          seleniumJWP.setSession(response);
          vm.session.id = response.sessionId;
          protractorRecServer.setRecording(true);
          vm.setSessionUrl();

        });

      } else {
        protractorRecServer.setRecording(true);
      }
    };

    vm.setSessionUrl = function () {
      seleniumJWP.setSessionUrl(vm.conf.baseUrl).success(function(){
        $log.debug('setSessionUrl');
        vm.getSessionUrl();
        vm.getSessionSource();
      });
    };

    vm.getSessionUrl = function () {
      seleniumJWP.getSessionUrl().success(function(response){
        $log.debug('getSessionUrl');
        vm.session.url = response.value;
      });
    };

    $scope.$watch('main.conf', function () {
      $log.debug('watch conf');
      localStorage.setItem('conf', angular.toJson(vm.conf));
    }, true);

    $scope.$watch('main.describe', function () {
      $log.debug('watch describe');
      localStorage.setItem('describes', angular.toJson(vm.describes));

    }, true);

    $scope.$watchCollection('main.describes', function () {
      $log.debug('watch describes');
      localStorage.setItem('describes', angular.toJson(vm.describes));
    }, true);

    $scope.$watch('main.spec', function () {
      $log.debug('watch spec');
      localStorage.setItem('describes', angular.toJson(vm.describes));

      vm.selectedItems = $filter('filter')(vm.spec.actions, {checked: true}).length;

      if(vm.selectedItems){
        vm.showSelectedOptions = true
      } else {
        vm.showSelectedOptions = false;
      }
    }, true);


    $scope.$watch('main.session', function () {
      $log.debug('watch session');
      localStorage.setItem('session', angular.toJson(vm.session));
    }, true);

    vm.toggleAll = function(){

      angular.forEach(vm.spec.actions, function(action){

        action.checked = !vm.selectAll;

      });

      if(vm.selectAll)
        vm.showSelectedOptions = false;

    };

    vm.toggleAction = function(action){
      if(!action.checked){
        //vm.showSelectedOptions = true;
      }
    };

    vm.removeActions = function(index){

      if(index != undefined){
        vm.spec.actions.splice(index, 1);
      } else {
        var i = vm.spec.actions.length;
        while (i--) {
          var action = vm.spec.actions[i];
          if (action.checked)
            vm.spec.actions.splice(i, 1);
        }
      }
    };

    vm.duplicateActions = function(index){

      if(index != undefined){
        var newAction = angular.copy(vm.spec.actions[index]);
        vm.spec.actions.push(newAction);
      }
    };

    vm.toggleBreakPoint = function(index) {
      if(vm.spec.actions[index].breakpoint == undefined)
        vm.spec.actions[index].breakpoint = true;
      else
        vm.spec.actions[index].breakpoint = !vm.spec.actions[index].breakpoint;
    };

    vm.addBrowserSleep = function(index) {
      var action = {
        action: 'browser',
        type: 'sleep',
        value: 1000
      };
      vm.spec.actions.splice(index, 0, action);
    };

    vm.sessionExecute = function () {

      seleniumJWP.sessionExecute(protractorRecServer.snippet).success(function() {
        $log.debug('Session Executed');


        if (!vm.isSnippet) {
          $mdToast.show(
              $mdToast.simple()
                  .content('Session ready to record!')
                  .position('bottom left')
                  .hideDelay(3000)
          );
        }

        protractorRecServer.setLoading(false);

        vm.isSnippet = true;
        vm.getSessionUrl();
      });

    };

    vm.getSessionSource = function () {

      if (vm.session.id) {
        seleniumJWP.getSessionSource().success(function(response) {
          vm.session.source = response.value;
          if(response.value) {
            vm.getNgIncludes();
            vm.verifySnippet();
          }
        }).error(function(response){
          $log.debug(response);
          $log.debug('Error session source');
          vm.deleteSession();
        });
      } else {
        protractorRecServer.setLoading(false);
        protractorRecServer.setRecording(false);
      }
    };

    /**
     * Get all html from ng-includes and concatenate with main source
     */
    vm.getNgIncludes = function () {

      $log.debug('getNgIncludes');

      var ngIncludes = vm.session.source.match(/ngInclude:\s?["|'](.*?)["|']/igm);

      $log.debug(ngIncludes);

      var includes = [];

      angular.forEach(ngIncludes, function (include) {

        include = include.replace(/:\s|\"|\'|ngInclude|{{|}}/g, '').trim();

        if (!$filter('filter')(includes, include).length) {

          protractorRecServer.getHtmlSource({url: vm.url, include: include}).success(function(response){
            vm.session.source += response;
            vm.getAllDataBind();
          });
        }
        includes.push(include);
      });
    };

    vm.verifySnippet = function(){

      var countIframe = vm.session.source.match(/recorder-iframe/);
      countIframe != null ? countIframe.length : countIframe = 0;

      if (!vm.isSnippet && countIframe == 0) {
        vm.sessionExecute();
      } else {
        protractorRecServer.setLoading(false);
      }
    };

    vm.clearSession = function(){
      vm.session = {};
      seleniumJWP.setSession();
      protractorRecServer.setLoading(false);
      protractorRecServer.setRecording(false);
    };

    vm.deleteSession = function(){
      seleniumJWP.deleteSession().success(function() {
        $log.debug('Session Deleted');
        vm.clearSession();
      }).error(function(response){
        $log.debug(response);
        vm.clearSession();
      });
    };



    vm.pauseRecording = function(){
      protractorRecServer.setRecording(false);
    };

    var DialogSpecController = function ($scope, $mdDialog, spec, describe) {

      var vm = this;

      vm.spec = spec;
      vm.describe = describe;

      vm.hide = function() {
        $mdDialog.hide();
      };

      vm.cancel = function() {
        $mdDialog.cancel();
      };

      vm.saveSpec = function() {
        $mdDialog.hide(vm);
      };
    };

    vm.specDialog = function(ev) {

      var spec     = angular.copy(vm.spec);
      var describe = angular.copy(vm.describe);

      var closeTo = angular.element($document[0].getElementById('edit-spec'));

      $mdDialog.show({
        controller: DialogSpecController,
        controllerAs: 'spec',
        templateUrl: 'app/main/spec-dialog.html',
        parent: angular.element($document[0].body),
        targetEvent: ev,
        closeTo: closeTo,
        locals: {
          spec: spec,
          describe: describe
        },
        clickOutsideToClose: true
      }).then(function(result) {
        if(result) {

          $filter('filter')(vm.describes[0].specs, {string: vm.spec.string})[0].string = result.spec.string;
          vm.spec = result.spec;
          vm.describes[0].string = result.describe.string;

          //localStorage.setItem('describes', angular.toJson(vm.describes));
        }
          //angular.copy(vm.spec, spec);
      }, function() {
      });
    };

    vm.getSessionElementId = function(element) {

      $log.debug('getSessionElementId');

      seleniumJWP.findSessionElements(element).success(function(response) {

        angular.forEach(response.value, function (value, index) {

          var length = response.value.length;
          var elementId = value.ELEMENT;
          var index = index;
          $log.debug(value.ELEMENT);

          seleniumJWP.getSessionElementDisplayed(elementId).success(function (response) {

            $log.debug(response);

            if (response.value) {

              if(length > 1)
                element.index = index;

              vm.sessionElementExecute(elementId, element);
            }

          })

        });

      }).error(function(response){
        $log.debug(response);
        $log.debug('index: ' + vm.index);

        vm.spec.actions[vm.index].error = true;
      });

    };

    vm.getElementAction = function(action){

      $log.debug('getElementAction');

      var element = {};

      element.keys = action.value;

      if(action.action == 'click' && action.type == 'a' && action.locator.type == 'linkText') {
        element.using      = 'link text';
        element.value      = action.value;
        element.action     = 'click';

        $log.debug(element);
        return element;
      }

      if(action.action == 'sendKeys') {

        angular.forEach(action.locators, function(locator){

          if(locator.strategy && !element.using) {
            element.using  = locator.strategy;
            element.value  = locator.value;
            element.action = 'value';
          }

        });

        $log.debug(element);
        return element;

      }

      if(action.action == 'click') {

        // Priority to use locator xpath
        var locator = $filter('filter')(action.locators, {type: 'xpath'})[0];

        if(locator) {

          element.using  = locator.strategy;
          element.value  = locator.value;
          element.action = 'click';

        } else {

          angular.forEach(action.locators, function (locator) {

            if (locator.strategy && !element.using) {

              element.using = locator.strategy;
              element.value = locator.value;
              element.action = 'click';
            }
          });

        }

        $log.debug(element);
        return element;
      }

      return false;

    };

    vm.sessionElementExecute = function(elementId, element){

      $log.debug('sessionElementExecute');

      var data = {};

      if(element.action == 'value'){
        data.value = [element.keys];
      }

      seleniumJWP.sessionElementExecute(elementId, element, data).success(function(response) {

        $log.debug(response);

        vm.spec.actions[vm.index].index = element.index;
        vm.spec.actions[vm.index].executed = true;

        if(vm.spec.actions[vm.index + 1]) {

          if(vm.spec.actions[vm.index + 1].action == 'wait' || vm.spec.actions[vm.index + 1].type == 'sleep') {

            $timeout(function () {
              vm.spec.actions[vm.index + 1].executed = true;
              vm.runFromHere(vm.index + 2);
            }, vm.spec.actions[vm.index + 1].value);

          } else {

            var time = vm.conf.runSpeed ? vm.conf.runSpeed : 0;
            $timeout(function () {
              vm.runFromHere(vm.index + 1);
            }, time);

          }

        } else {

          $mdToast.show(
              $mdToast.simple()
                  .content('Actions executed!')
                  .position('bottom left')
                  .hideDelay(3000)
          );

          angular.forEach(vm.spec.actions, function(action){
            action.executed = false;
          });

        }

      });

    };

    vm.clearRunTestResult = function(){
      angular.forEach(vm.spec.actions, function(action){
        action.executed = false;
        action.error    = false;
      });
    };

    vm.getSessionSource();

  }

})();
