// https://drive.google.com/file/d/1Il81Wjbky0-rnTC8AKOJIW5cProYS2Oz/view?usp=drive_link


// this is a test to emulate setting cahe entry and returning the link to access it
// normally something like this would be attached to a click event client side
// in this case, my file id is in the property gmlExportId
// the config parameter could contain many other properties that helps to persinalize the cache key
const testSetCache = () => {
  const state = Exports.StateHandler.toCache({ config: { gmlExportId: "1Il81Wjbky0-rnTC8AKOJIW5cProYS2Oz", name: "orange", foo: "bar" } })
  // this link should only work once, and only for the person who created it - try it in various contexts
  console.log("here's the link", state)

}



// Since we are using state to call back, there's no need for this function to do anything
// and it should never be called directly
const doGet = () => {
  throw 'Unexpected call to webapp'
}

/**
 * this is call back using the stateToken
 * @param {object} e the callback data
 * @param {object} e.parameter the parameter object
 * @param {string} e.parameter.key the cache key
 * @param {string} [e.parameter.probe = "no"]  yes or no - yes means dont return the value just the metadata
 * @param {number} e.parameter.nonce used to validate against the data returned from cache
 * @return {ContentService.TextOutput} if probe then metadata otherwise the content
 */
const publishFromCache = (e = {}) => {
  const { parameter = {} } = e
  const { key, probe = "no", nonce: sNonce } = parameter
  if (!key) throw `Key missing from state parameters`
  if (!sNonce) throw `nonce missing from state parameters`

  // convert nonce to a number as it will have come thru as a string
  const nonce = parseInt(sNonce)

  // now get the value from cache
  const item = Exports.StateHandler.getCacheStore().get(key)

  // probe can be used as a check to see if the value is available with returning the content
  if (!item) {
    // no value found returns this
    return probe == "yes"
      ? ContentService.createTextOutput(JSON.stringify({
        good: false,
        key
      })).setMimeType(ContentService.MimeType.JSON)
      : ContentService.createTextOutput()
  } else {
    const value = JSON.parse(item)
    // check that nonce matches

    if (nonce !== value.nonce) throw `Attempt to access the wrong cache entry ${typeof nonce} ${typeof value.nonce}`

    const serveAs = ContentService.MimeType[value.serveAs]
    if (!serveAs) throw `We can't serve content as ${value.serveAs}`

    // this shouldn't happen so can be another protection
    // it would mean that the state url has expired, but the cache item has still been somehow found
    // we'll allow a small buffer just in case of processing time delays
    if (value.expires + 1000 < new Date().getTime()) throw `cache item has already expired`

    // finally we can safely release the content
    return probe == "yes"
      ? ContentService.createTextOutput(JSON.stringify({
        good: true,
        key,
        contentType: value.contentType,
        serveAs,
        name: value.name,
        expires: value.expires
      })).setMimeType(ContentService.MimeType.JSON)
      : ContentService.createTextOutput(Exports.Utils.b64ToBlob(value.b64).getDataAsString()).setMimeType(serveAs)
  }

}


const StateHandler = (() => {

  // how long in seconds the link should be valid for
  const STATETIMETOLIVE = 2 * 60

  // the cache entry it applies to should be a little longer before dying out 
  const TIMETOLIVE = STATETIMETOLIVE + 30


  /**
   * generate a state token plus the url it applies to which will be th currently deployed endpoint
   * @param {object} param the params
   * @param {string} callback the name of the function to call - needs to be in globacl space 
   * @param {object} [args={}] the args to pass to the callback
   * @param {number} [timeout=120] how long the link should live for
   * @param {string} [serviceUrl] the service url to override the published one available in this context
   * @return {string} the callback url with the statetoken attached
   */
  const makeToken = ({ callback, args = {}, timeout = 120, serviceUrl }) => {

    // current deployment url
    // if the web app jas been deployed from the main script,we can use the service url from scriptApp
    // however - if the webapp has been deployed from a library being used by the main script
    // it won't be known here - so it needs to be passed over
    let surl = serviceUrl || ScriptApp.getService().getUrl();
    if (!surl) throw `No service url was found - has webapp been deployed properly?`


    // replace the /dev, /exec with a callback
    const url = surl.replace(/(.*)\/.*/, "$1/usercallback?state=")
    console.log('maketoken url/args', url, args)
    // generate a token with the callback and whatever arguments are required
    const stateToken = ScriptApp.newStateToken()
      .withMethod(callback)
      .withTimeout(timeout)

    // add arguments
    Reflect.ownKeys(args).forEach(f => stateToken.withArgument(f, args[f]))

    // tag on to service url
    return url + stateToken.createToken();

  }

  // important that we use the usercache to limit access to the same person that created the link
  const getCacheStore = () => CacheService.getUserCache()

  /**
 * write contents of file to cache
 * @param {object} params the params
 * @param {string} [serviceUrl] the service url to override the published one available in this context
 * @param {object} config configuration data that uniquely identifies the file content
 * @param {ContentService.MimeType} [serveAs="TEXT"] for example JSON , TEXT  etc.. 
 * @return {string} the state url to retrieve this data 
 */
  const toCache = ({ config, serveAs = "TEXT", serviceUrl }) => {

    // get file contents
    const id = config && config.gmlExportId
    if (!id) throw `missing file id in config`

    // get the file content
    const file = DriveApp.getFileById(id)
    if (!file) throw `couldnt find export file id ${id}`

    if (!ContentService.MimeType[serveAs]) throw `${serveAs} is an invalid contentservice mimetype`

    // get the file content
    const blob = file.getBlob()
    const nonce = new Date().getTime()

    // generate a key for uniqueness
    const cacheKey = Exports.Utils.digester(config, nonce)

    // put to cache 
    // this'll create  an object {b64, contenttype, name} of the file content
    // and we'll decorate that with some other metadata
    const pack = {
      ...Exports.Utils.blobToCache(blob),
      nonce,
      serveAs,
      expires: STATETIMETOLIVE * 1000 + nonce
    }
    getCacheStore().put(cacheKey, JSON.stringify(pack), TIMETOLIVE)

    // now generate the link
    const state = makeToken({
      serviceUrl,
      callback: "publishFromCache",
      args: {
        key: cacheKey,
        probe: "no",
        nonce
      },
      timeout: STATETIMETOLIVE
    })
    return state
  }

  return {
    getCacheStore,
    toCache
  }

})()

