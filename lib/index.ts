/// <reference path="./index.d.ts" />

// having weak reference to styles prevents garbage collection
// and "losing" styles when the next test starts
const stylesCache = new Map()

const setXMLHttpRequest = w => {
  // by grabbing the XMLHttpRequest from app's iframe
  // and putting it here - in the test iframe
  // we suddenly get spying and stubbing 😁
  // @ts-ignore
  window.XMLHttpRequest = w.XMLHttpRequest
  return w
}

const setAlert = w => {
  window.alert = w.alert
  return w
}

/** Initialize an empty document w/ ReactDOM and DOM events.
    @function   cy.injectReactDOM
**/
Cypress.Commands.add('injectReactDOM', () => {
  return cy.log('Injecting ReactDOM for Unit Testing').then(() => {
    // Generate inline script tags for UMD modules
    const scripts = Cypress.modules
      .map(module => `<script>${module.source}</script>`)
      .join('')
    // include React and ReactDOM to force DOM to register all DOM event listeners
    // otherwise the component will NOT be able to dispatch any events
    // when it runs the second time
    // https://github.com/bahmutov/cypress-react-unit-test/issues/3
    var html = `<body>
          <div id="cypress-jsdom"></div>
          ${scripts}
        </body>`
    const document = cy.state('document')
    document.write(html)
    document.close()
  })
})

Cypress.stylesCache = stylesCache

/** Caches styles from previously compiled components for reuse
    @function   cy.copyComponentStyles
    @param      {Object}  component
**/
Cypress.Commands.add('copyComponentStyles', component => {
  // need to find same component when component is recompiled
  // by the JSX preprocessor. Thus have to use something else,
  // like component name
  const hash = component.type.name
  const document = cy.state('document')
  let styles = document.querySelectorAll('head style')
  if (styles.length) {
    cy.log('injected %d styles', styles.length)
    Cypress.stylesCache.set(hash, styles)
  } else {
    cy.log('No styles injected for this component, checking cache')
    if (Cypress.stylesCache.has(hash)) {
      styles = Cypress.stylesCache.get(hash)
    } else {
      styles = null
    }
  }
  if (!styles) {
    return
  }
  const parentDocument = window.parent.document
  // hmm, is this really project name?
  // @ts-ignore
  const projectName = Cypress.config('projectName')
  const appIframeId = "Your App: '" + projectName + "'"
  const appIframe = parentDocument.getElementById(appIframeId)
  // @ts-ignore
  var head = appIframe.contentDocument.querySelector('head')
  styles.forEach(function (style) {
    head.appendChild(style)
  })
})

/**
 * Mount a React component in a blank document; register it as an alias
 * To access: use an alias or original component reference
 *  @function   cy.mount
 *  @param      {Object}  jsx - component to mount
 *  @param      {string}  [Component] - alias to use later
 *  @example
 ```
 import Hello from './hello.jsx'
 // mount and access by alias
 cy.mount(<Hello />, 'Hello')
 // using default alias
 cy.get('@Component')
 // using specified alias
 cy.get('@Hello').its('state').should(...)
 // using original component
 cy.get(Hello)
 ```
 **/
export const mount = (jsx, alias) => {
  // Get the display name property via the component constructor
  const displayname = alias || jsx.type.prototype.constructor.name
  cy.injectReactDOM()
    .log(`ReactDOM.render(<${displayname} ... />)`, jsx.props)
    .window({ log: false })
    .then(setXMLHttpRequest)
    .then(setAlert)
    .then(win => {
      const { ReactDOM } = win
      const document = cy.state('document')
      const component = ReactDOM.render(
        jsx,
        document.getElementById('cypress-jsdom')
      )
      cy.wrap(component, { log: false }).as(displayname)
    })
  cy.copyComponentStyles(jsx)
}

Cypress.Commands.add('mount', mount)

/** Get one or more DOM elements by selector or alias.
    Features extended support for JSX and React.Component
    @function   cy.get
    @param      {string|object|function}  selector
    @param      {object}                  options
    @example    cy.get('@Component')
    @example    cy.get(<Component />)
    @example    cy.get(Component)
**/
Cypress.Commands.overwrite('get', (originalFn, selector, options) => {
  switch (typeof selector) {
    case 'object':
      // If attempting to use JSX as a selector, reference the displayname
      if (
        selector.$$typeof &&
        selector.$$typeof.toString().startsWith('Symbol(react')
      ) {
        const displayname = selector.type.prototype.constructor.name
        return originalFn(`@${displayname}`, options)
      }
    case 'function':
      // If attempting to use the component name without JSX (testing in .js/.ts files)
      const displayname = selector.prototype.constructor.name
      return originalFn(`@${displayname}`, options)
    default:
      return originalFn(selector, options)
  }
})

const moduleNames = [
  {
    name: 'react',
    type: 'file',
    location: 'node_modules/react/umd/react.development.js'
  },
  {
    name: 'react-dom',
    type: 'file',
    location: 'node_modules/react-dom/umd/react-dom.development.js'
  }
]

/*
Before All
- Load and cache UMD modules specified in fixtures/modules.json
  These scripts are inlined in the document during unit tests
  modules.json should be an array, which implicitly sets the loading order
  Format: [{name, type, location}, ...]
*/
before(() => {
  Cypress.modules = []
  cy.log('Initializing UMD module cache').then(() => {
    for (const module of moduleNames) {
      let { name, type, location } = module
      cy.log(`Loading ${name} via ${type}`)
        .readFile(location)
        .then(source => Cypress.modules.push({ name, type, location, source }))
    }
  })
})