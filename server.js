var net = require('net');
var fs = require('fs');
var url = require('url');
var qs = require('querystring');
var uuid = require('node-uuid');

//-------------------------------Objects---------------------------------------

var SESSIONS = {};

var ROUTES = {
    get: {},
    post: {}
}

var METHOD = {
    GET: getHandler,
    POST: postHandler
}

var CONTENT_TYPE = {
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    jpeg: 'image/jpeg',
    jpg: 'image/jpg',
    png: 'image/png',
    gif: 'image/gif',
    ico: 'image/x-icon',
    text: 'text/plain',
    json: 'application/json'
}

//-----------------------------Stringify----------------------------------------

function stringifyResponse(response) {
    var responseString = response['status'] + '\r\n';
    for (key in response) {
        if (response.hasOwnProperty(key) && key != 'content' && key != 'status') {
            responseString += key + ': ' + response[key] + '\r\n';
        }
    }
    responseString += '\r\n';
    if ('content' in response) responseString += response['content'];
    return responseString;
}

//-------------------------------PARSING---------------------------------------

function formPartsParser(request, formPart, index) {
    /*var key = formPart['header'].match(/\bname=\"(.*?)\"/)[1];
        Alternative for keys in form object */
    var key = 'field'+index;
    request['form'][key] = {};
    partArray = [];
    partObj = {};
    formPart['header'].split('; ').forEach(function(hParts, index) {
        partArray = hParts.split(/=|: /);
        partObj[partArray[0]] = partArray[1].replace(/['"]+/g, ''); //Remove redundant quotes(", ') from strings.
    });
    if (formPart['content']) {
        if (isFinite(formPart['content'])) { //Checks if the content is number or not.
            partObj['content'] = parseFloat(formPart['content']);
        } else {
            partObj['content'] = formPart['content'];
        }
    } else {
        partObj['content'] = undefined;
    }
    request['form'][key] = partObj;
}

function multipartParser(request) {
    request['form'] = {};
    request['boundary'] = '--' + request['header']['Content-Type'].split('=')[1];
    var formPart = {};
    var formArray = [];
    request['body'].split(request['boundary']).forEach(function(formData, index) {
        if (formData) {
            //form[index+1] = {};
            formArray = formData.split('\r\n\r\n');
            formPart['header'] = formArray[0].substring(2).replace(/\r\n/g, '; '); //Substring: ommiting \r\n from header and regex for headers.
            formPart['content'] = formArray[1].slice(0, -2); //Removes \r\n from end of the content.
            if (formPart['header']) {
                formPartsParser(request, formPart, index);
            }
        }
    });
}

function bodyParser(request, bodyParts) { //FOR POST REQUEST: //Fix this for multiple Content-Type in request['header'].
    if (request['header']['Content-Type'] == 'application/x-www-form-urlencoded') {
            request['body'] = bodyParts[1];
    } else {
        var bodyString = '';
        bodyParts.forEach(function(bodyPart, index) {
            if (index > 0) {
                bodyString += bodyPart + '\r\n\r\n';// FIX THIS FOR Contnt-type = x-www-form-urlencoded
            }
        });
        request['body'] = bodyString;
    }
}

function cookieParser(request) {
    if (request['header'].hasOwnProperty('Cookie')) {
        console.log("Cookie is present\n");
        var clientCookies = {};
        request['header']['Cookie'].split('; ').forEach(function(cook) {
           var cookArr = cook.trim().split('=');
           clientCookies[cookArr[0]] = cookArr[1];
        });
        request['header']['Cookie'] = clientCookies;

    } else {
          console.log("Cookie not resent\n");
          request['header']['Cookie'] = {};
    }
}

function protocolParser(request, prot) {
    request['header']['method'] = prot[0];
    request['header']['path'] = prot[1];
    request['header']['version'] = prot[2];
}

function headerParser(request, headerParts) {
    protocolParser(request, headerParts[0].split(' '));
    headerParts.forEach(function(head, index) {
        if (index > 0) {
            var elem = head.split(': ');
            request['header'][elem[0]] = elem[1];
        }
    });
    cookieParser(request);
}

//-----------------------Session - Handlers-------------------------------------

function deleteSession(request) {
    var clientCookie = request['header']['Cookie'];
    if (clientCookie.hasOwnProperty('sid')) {
        var sid = clientCookie['sid'];
        if (SESSIONS.hasOwnProperty(sid)) {
            delete SESSIONS[sid];
        }
    }
}

function getSession(request) {
    var clientCookie = request['header']['Cookie'];
    if (clientCookie.hasOwnProperty('sid')) {
        var sid = clientCookie['sid'];
        if (SESSIONS.hasOwnProperty(sid)) {
            return SESSIONS[sid];
        }
    }
}

function addSession(request, content) {
    var clientCookie = request['header']['Cookie'];
    if (clientCookie.hasOwnProperty('sid')) {
        var sid = clientCookie['sid'];
        if (SESSIONS.hasOwnProperty(sid)) {
            SESSIONS[sid] = content;
        }
    }
}
//--------------------------Response - Handlers---------------------------------
function responseHandler(request, response) {
    response['Date'] = new Date().toUTCString();
    response['Connection'] = 'close';
    response['Server'] = 'NodeServer';
    var responseString = stringifyResponse(response);
    console.log("SESSIONS AT THE END:");
    console.log(SESSIONS);
    console.log("\nEND OF REQUEST-RESPONSE CYCLE-------------------------------------------------------------\n");
    request["socket"].write(responseString, function(err) {
            if (err) {
                console.log('SOCKET-WRITE-ERROR');
            } else {
                request["socket"].end();
            }
    });
}

function ok200Handler(request, response) {
    response['status'] = 'HTTP/1.1 200 OK';
    if (response['content']) {
        response['Content-Length'] = (response['content'].length).toString();
    }
    responseHandler(request, response);
}

function err404Handler(request, response) {
    response['status'] = "HTTP/1.1 404 Not Found";
    response['content'] = "Content Not Found";
    response['Content-type'] = "text/HTML";
    responseHandler(request, response);
}

function sendJSON(request, response, content) {
    if (content) {
        response['content'] = JSON.stringify(content);
        response['Content-type'] = 'application/json';
        ok200Handler(request, response);
    } else {
        err404Handler(request, response)
    }
}

function sendHTML(request, response, content) {
    if (content) {
        response['content'] = content;
        response['Content-type'] = 'text/html';
        ok200Handler(request, response);
    } else {
        err404Handler(request, response)
    }
}

function staticFileHandler(request, response) {
    var filePath = request['header']['path'];
    if (filePath == '/') {
        filePath = './public/index.html';
    } else {
        filePath = './public' + filePath;
    }
    fs.readFile(filePath, function(err, data) {
        if (err) {
            err404Handler(request, response);
        } else {
            response['content'] = data.toString();
            var contentType = filePath.split('.').pop();
            response['Content-type'] = CONTENT_TYPE[contentType];
            ok200Handler(request, response);
        }
    });
}

//---------------------------Request-Handlers-----------------------------------

function postHandler(request, response) {
    try {
        if (request['header']['Content-Type'].includes('multipart/form-data')) {
            multipartParser(request);
            console.log('\nPOST REQUEST DATA:' );
            console.log(request['form']);
            console.log('POST REQUEST DATA ENDS:\n' );
        } else {
            request['content'] = qs.parse(request['body']);
            console.log('\nPOST REQUEST DATA:' );
            console.log(request['content']);
            console.log('POST REQUEST DATA ENDS:\n' );
        }
        ROUTES['post'][request['header']['path']](request, response);
    }
    catch(e) {
        err404Handler(request, response);
    }
}

function getHandler(request, response) {
    try {
        ROUTES['get'][request['header']['path']](request, response);
    }
    catch(e) {
        staticFileHandler(request,response);
    }
}


function methodHandler(request,response) {
    METHOD[request['header']['method']](request,response);
}


function sessionHandler(request, response) {
    if(request['header']['Cookie'].hasOwnProperty('sid')) {
        if (SESSIONS.hasOwnProperty(request['header']['Cookie']['sid'])) {
            return;
        } else {
            SESSIONS[request['header']['Cookie']['sid']] = {};
        }
    } else {
        var cookie = uuid.v4().toString();
        var someDate = new Date();
        someDate.setDate(someDate.getDate() + 6);
        response['Set-Cookie'] = 'sid=' + cookie+"; expires=" + someDate;
        SESSIONS[cookie] = {};
    }
}

function requestHandler(request, requestString) {
    var response = {};
    var requestParts = requestString.split('\r\n\r\n');
    headerParser(request, requestParts[0].split('\r\n'));

    if (request['header']['method'] === 'POST') {
        bodyParser(request, requestParts);
    }
    sessionHandler(request, response);
    methodHandler(request,response);
}

//------------------------------ROUTING-----------------------------------------

function addRoute(method, path, func) {
    ROUTES[method][path] = func;
}

function startServer(port) {
    net.createServer(function(socket) {
        var request = {};
        request["socket"] = socket;
        request['header'] = {};
        request['body'] = {};

        socket.on('error', function(exception) {
            console.log("SOCKET-ERROR: " + exception);
            socket.end();
        });
        socket.on('data', function(rawRequest) {
            console.log('SESSIONS AT THE BEGINING:');
	        console.log(SESSIONS);
	        console.log('------------------------RAW-REQUEST\n' +  rawRequest.toString() + '\n-------------------RAW-REQUEST-ENDS');
            requestHandler(request, rawRequest.toString());
        });
    }).listen(port);
}

//----------------------------------API----------------------------------------

exports.addRoute = addRoute;
exports.startServer = startServer;
exports.err404Handler = err404Handler;
exports.sendHTML = sendHTML;
exports.sendJSON = sendJSON;
exports.addSession = addSession;
exports.getSession = getSession;
exports.deleteSession = deleteSession;
