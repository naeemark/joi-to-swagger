#! /usr/bin/env node
const argv = require('yargs')
            .alias('v', 'validator')
            .alias('o', 'output')
            .alias('h', 'header')
            .alias('b', 'baseUrl')
            .alias('m', 'mapPath')
            .alias('g', 'apiGatewayPath')
            .describe('v', 'Location of validator file or directory of the folder')
            .describe('o', 'Location of the output file location')
            .describe('h', 'Location of the header file in json format')
            .describe('r', 'For multiple files, will recursively search for .validator.js file in that directory')
            .describe('b', 'Override base url')
            .describe('m', 'Override redirect path')
            .describe('g', 'Api Gateway base path')
            .demandOption(['v','o','h'])
            .help('help')
            .example('joi-to-swagger -r -v ./validators -h ./header.json -o ./swagger.json')
            .argv

const j2s = require('joi-to-swagger');
const path = require('path');
const fs = require('fs-extra');
const glob = require("glob")

String.prototype.capitalize = function() {
    return this.charAt(0).toUpperCase() + this.slice(1);
}
const relativeValidatorPath = argv.validator;
const validatorFile = path.resolve(relativeValidatorPath);

function applyLogic(json, apiList){
    const basePath = json.basePath;      
    json.info.description = "<b>Environment: `" + process.env.NODE_ENV+ "` </b><br /><br />" + json.info.description;

    json.paths = {};
    json.definitions = {};
   
    for(key in apiList) {
        const mapHeader = {};
        const requestMap = {};
        const currentValue = apiList[key];

        let paths;
        let convertedPath = path.join(basePath, currentValue.path);
        convertedPath = convertPath(convertedPath);

        if(argv.apiGatewayPath){
            const apiGatewayPath = path.join(argv.apiGatewayPath, convertedPath);

            if(json.paths[apiGatewayPath]){
                paths = json.paths[apiGatewayPath];
            } else {
                paths = {};
                json.paths[apiGatewayPath] = paths;
            }
        } else {
            if(json.paths[convertedPath]){
                paths = json.paths[convertedPath];
            } else {
                paths = {};
                json.paths[convertedPath] = paths;
            }
        }

        let parameters = []
        let responses = {};
        let deprecated = false

        if(!currentValue.JoiSchema){
            currentValue.JoiSchema = currentValue.joiSchema;
        }
        if(currentValue.JoiSchema){
            if(currentValue.JoiSchema.headers){
                const {swagger} = j2s(currentValue.JoiSchema.headers);

                for(headerKey in swagger.properties) {
                    parameters.push({
                        name: headerKey,
                        in: "header",
                        required: swagger.required.includes(headerKey),
                        type: swagger.properties[headerKey].type
                    });
                    requestMap[`integration.request.header.${headerKey}`] = `method.request.header.${headerKey}`;
                }
            }
            if(currentValue.JoiSchema.body){
                const {swagger} = j2s(currentValue.JoiSchema.body);

                const modelName = `${currentValue.name.replace(/\s/g, "")}${currentValue.type.capitalize()}Body`;
                json.definitions[modelName] = swagger;
                parameters.push({
                    name: "body",
                    in: "body",
                    schema: {
                        $ref: `#/definitions/${modelName}`
                    }
                });
            }
            if(currentValue.JoiSchema.path){
                const {swagger} = j2s(currentValue.JoiSchema.path);

                for(pathKey in swagger.properties) {
                    parameters.push({
                        name: pathKey,
                        in: "path",
                        required: true,
                        type: swagger.properties[pathKey].type
                    });
                }
            }
            if(currentValue.JoiSchema.params){
                const {swagger} = j2s(currentValue.JoiSchema.params);

                for(pathKey in swagger.properties) {
                    parameters.push({
                        name: pathKey,
                        in: "path",
                        required: true,
                        type: swagger.properties[pathKey].type
                    });
                }
            }
            if(currentValue.JoiSchema.query){
                const {swagger} = j2s(currentValue.JoiSchema.query);

                for(queryKey in swagger.properties) {
                    parameters.push({
                        name: queryKey,
                        in: "query",
                        required: swagger.required ? swagger.required.includes(queryKey) : false,
                        type: swagger.properties[queryKey].type
                    });
                }
            }
            if(currentValue.JoiSchema.response){
                responses = {};
                const {swagger} = j2s(currentValue.JoiSchema.response);

                for(statusCode in swagger.properties) {
                    const modelName = `${currentValue.name.replace(/\s/g, "")}${currentValue.type.capitalize()}${statusCode}Response`;
                    json.definitions[modelName] = swagger.properties[statusCode].properties.body;

                    const data = {
                        description: swagger.properties[statusCode].properties.description.enum[0],
                        schema: {
                            $ref: `#/definitions/${modelName}`
                        },
                    };

                    if(swagger.properties[statusCode].properties.header){
                        data['headers'] = swagger.properties[statusCode].properties.header.properties;

                        for(headerName in swagger.properties[statusCode].properties.header.properties) {
                            mapHeader[`integration.response.header.${headerName}`] = `method.response.header.${headerName}`;
                        }
                    }

                    if(statusCode >= 200 && statusCode < 400){
                        if(!data.headers){
                            data.headers = {};
                        }                    
                    }
                    responses[statusCode] = data;
                }
            }
            // check for deprecation
            if(currentValue.JoiSchema.deprecated && currentValue.JoiSchema.deprecated === true) {
                deprecated = true
            }
        }

        const queryParameters = parameters.filter(param => param.in === 'query').map(param => `method.request.querystring.${param.name}`)
        const pathParameters  = parameters.filter(param => param.in === 'path').map(param => `method.request.path.${param.name}`)
        
        paths[currentValue.type] = {
            summary: currentValue.name,
            tags: currentValue.tags,
            consumes: [
                'application/json'
            ],
            produces: [
                'application/json'
            ],
            parameters,
            responses,
            deprecated,
        }
    }
    return json;
}

if(argv.r){
    glob(path.join(validatorFile, "**/*.validator.js"), function (er, files) {
        let requires = []
        files.forEach((value, index, array) => {
            requires.push(require(value))
        })

        const relativeHeaderPath = argv.header;
        const headerFile = path.resolve(relativeHeaderPath);
        if(!fs.pathExistsSync(headerFile)){
            return console.error(`Header file not found in ${headerFile}, please create header file first`);
        } else {
            try {
                fs.ensureFileSync(headerFile);
            } catch(e){
                return console.error(`Header file not found in ${headerFile}, please create header file first`);
            }
        }

        let json = require(headerFile);

        const relativeOutputFile = argv.output;
        if(!relativeOutputFile){
            return console.error("Output file location is required");
        }
        const outputFile = path.resolve(relativeOutputFile);

        json = applyLogic(json, requires)

        fs.outputFile(outputFile, JSON.stringify(json, null, 4), function(err){
            if(err) {
                console.error(err);
            } else {
                console.log('Successfully added: ' + outputFile);
            }
        });
    })
} else {
    if(!fs.pathExistsSync(validatorFile)){
        return console.error(`Validator file not found in ${validatorFile}, please create validator file first`);
    } else {
        try {
            fs.ensureFileSync(validatorFile);
        } catch(e){
            return console.error(`Validator file not found in ${validatorFile}, please create validator file first`);
        }
    }
    const validator = require(validatorFile);

    const relativeHeaderPath = argv.header;
    const headerFile = path.resolve(relativeHeaderPath);
    if(!fs.pathExistsSync(headerFile)){
        return console.error(`Header file not found in ${headerFile}, please create header file first`);
    } else {
        try {
            fs.ensureFileSync(headerFile);
        } catch(e){
            return console.error(`Header file not found in ${headerFile}, please create header file first`);
        }
    }

    let json = require(headerFile);

    const relativeOutputFile = argv.output;
    if(!relativeOutputFile){
        return console.error("Output file location is required");
    }
    const outputFile = path.resolve(relativeOutputFile);

    json = applyLogic(json, validator.apiList);
    fs.outputFile(outputFile, JSON.stringify(json, null, 4), function(err){
        if(err) {
            console.error(err);
        } else {
            console.log('Successfully added: ' + outputFile);
        }
    });
}

function convertPath(path){
    const splitPath = path.split('/');
    for(const i in splitPath){
        let eachPath = splitPath[i];
        if(eachPath.startsWith(":")){
            eachPath = eachPath.substr(1); //remove :
            eachPath = "{" + eachPath + "}";//make {path}
            splitPath[i] = eachPath;
        }
    }
    path = splitPath.join('/');
    return path;
}
