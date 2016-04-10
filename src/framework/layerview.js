'use strict';
var $ = require('./domhelpers.js');
var Kern = require('../kern/Kern.js');
var pluginManager = require('./pluginmanager.js');
var layoutManager = require('./layoutmanager.js');
var LayerData = require('./layerdata.js');
var GroupView = require('./groupview.js');
var ScrollTransformer = require('./scrolltransformer.js');
/**
 * A View which can have child views
 * @param {LayerData} dataModel
 * @param {object}        options
 * @extends GroupView
 */

var LayerView = GroupView.extend({
  constructor: function(dataModel, options) {
    options = options || {};
    var that = this;
    this._preparedTransitions = {};
    this.inTransform = false;

    var tag = 'div';

    if (dataModel) {
      tag = dataModel.attributes.tag;
    }
    this.outerEl = options.el || document.createElement(tag);


    var hasScroller = this.outerEl.childNodes.length === 1 && this.outerEl.childNodes[0].getAttribute('data-wl-helper') === 'scroller';
    this.innerEl = hasScroller ? this.outerEl.childNodes[0] : this.outerEl;

    // call super constructor
    GroupView.call(this, dataModel, Kern._extend({}, options, {
      noRender: true
    }));
    this._layout = new(layoutManager.get(this.data.attributes.layoutType))(this);
    this._transformer = this._layout.getScrollTransformer() || new ScrollTransformer(this);

    if (hasScroller && !this.data.attributes.nativeScroll) $.unwrapChildren(this.outerEl);
    // should we have a scroller but don't have one?
    if (!hasScroller && this.data.attributes.nativeScroll) {
      // set el to scroller
      this.innerEl = $.wrapChildren(this.outerEl);
      hasScroller = true;
    }
    if (hasScroller) {
      this.innerEl = this.outerEl.childNodes[0];
      this.outerEl.className += ' nativescroll'; // this will be used to add the correct style via css style sheet
    }
    // mark scroller as scroller in HTML
    if (hasScroller) this.innerEl.setAttribute('data-wl-helper', 'scroller');
    this.nativeScroll = this.data.attributes.nativeScroll;

    // this is my stage and add listener to keep it updated
    this.stage = this.parent;
    this.on('parent', function() {
      that.stage = that.parent;
      // FIXME trigger adaption to new stage
    });
    // set current frame from data object or take first child
    this.currentFrame = (this.data.attributes.defaultFrame && this.getChildViewByName(this.data.attributes.defaultFrame)) || (this.data.attributes.children[0] && this.getChildView(this.data.attributes.children[0]));
    if (!options.noRender && (options.forceRender || !options.el)) {
      this.render();
    }
    // set the initial frame if possible
    if (this.currentFrame) {
      this.showFrame(this.currentFrame.data.attributes.name);
    }
    // listen to scroll events
    this.outerEl.addEventListener('scroll', function() {
      var keys = Object.keys(that._preparedTransitions);
      var i;
      for (i = 0; i < keys.length; i++) {
        // mark prepared transitions direty because they assume a wrong scroll transform
        // don't delete prepared transitions because everything else is still valid
        that._preparedTransitions[i]._dirty = true;
      }
    });
  },
  /**
   * show current frame immidiately without transition/animation
   *
   * @param {string} framename - the frame to be active
   * @param {Object} scrollData - information about the scroll position to be set. Note: this is a subset of a
   * transition object where only startPosition, scrollX and scrollY is considered
   * @returns {void}
   */
  showFrame: function(framename, scrollData) {
    if (!this.stage) {
      return;
    }
    scrollData = scrollData || {};
    var that = this;
    var frame = this.getChildViewByName(framename);
    if (!frame) throw "transformTo: " + framename + " does not exist in layer";
    this._layout.loadFrame(frame).then(function() {
      var targetFrameTransformData = frame.getTransformData(that.stage, scrollData.startPosition);
      that.currentTransform = that._transformer.getScrollTransform(targetFrameTransformData, scrollData.scrollX || 0, scrollData.scrollY || 0);
      that._layout.showFrame(frame, targetFrameTransformData, that.currentTransform);
    });
  },
  /**
   * transform to a given frame in this layer with given transition
   *
   * @param {string} [framename] - (optional) frame name to transition to
   * @param {Object} [transition] - (optional) transition object
   * @returns {Kern.Promise} a promise fullfilled after the transition finished. Note: if you start another transtion before the first one finished, this promise will not be resolved.
   */
  transitionTo: function(framename, transition) {
    // is framename  omitted?
    if (typeof framename === 'object') {
      transition = framename;
    }
    framename = framename || transition.framename;
    if (!framename) throw "transformTo: no frame given";
    // transition ommitted? create some default
    transition = Kern._extend({
      type: 'default',
      duration: '1s'
        // FIXME: add more default values like timing
    }, transition || {});
    // lookup frame by framename
    var frame = this.getChildViewByName(framename);
    if (!frame) throw "transformTo: " + framename + " does not exist in layer";
    var that = this;
    // make sure frame is there such that we can calculate dimensions and transform data
    return this._layout.loadFrame(frame).then(function() {
      // calculate the layer transform for the target frame. Note: this will automatically consider native scrolling
      // getScrollIntermediateTransform will not change the current native scroll position but will calculate
      // a compensatory transform for the target scroll position.
      var targetFrameTransformData = frame.getTransformData(that.stage, transition.startPosition);
      that.currentTransform = that._transformer.getScrollTransform(targetFrameTransformData, transition.scrollX || 0, transition.scrollY || 0, true);
      return that._layout.transitionTo(frame, transition, targetFrameTransformData, that.currentTransform).then(function() {
        // this will now calculate the currect layer transform and set up scroll positions in native scroll
        that.currentTransform = that._transformer.getScrollIntermediateTransform(targetFrameTransformData, transition.scrollX || 0, transition.scrollY || 0);
        // apply new transform (will be 0,0 in case of native scrolling)
        that._layout.setLayerTransform(that.currentTransform);
      });
    });
  },
  getCurrentTransform: function() {
    return this.currentTransform;
  },
  /**
   * temporary function that indicates whether scrolling in a "direction" is possible. This function is obsolete as the gesture handling will be different in future.
   *
   * @param {string} direction - direction of gesture e.g. "up"
   * @returns {Boolean} true if it would scroll.
   */
  gestureCanScroll: function(direction) {
    var tfd = this._currentFrameTransformData;
    if (direction === 'up' && tfd.isScrollY && this.outerEl.scrollTop > 0) {
      return true;
    } else if (direction === 'down' && tfd.isScrollY && this.outerEl.scrollTop < tfd.maxScrollY) {
      return true;
    } else if (direction === 'left' && tfd.isScrollX && this.outerEl.scrollLeft > 0) {
      return true;
    } else if (direction === 'right' && tfd.isScrollX && this.outerEl.scrollLeft < tfd.maxScrollX) {
      return true;
    }
    return false;
  },
  /**
   * render child positions. overriden default behavior of groupview
   *
   * @param {ObjView} childView - the child view that has changed
   * @returns {Type} Description
   */
  _renderChildPosition: function(childView) {
    childView.disableObserver();
    this._layout.renderFramePosition(childView, this._currentTransform);
    childView.enableObserver();
  }
}, {
  Model: LayerData
});

pluginManager.registerType('layer', LayerView);

module.exports = LayerView;
