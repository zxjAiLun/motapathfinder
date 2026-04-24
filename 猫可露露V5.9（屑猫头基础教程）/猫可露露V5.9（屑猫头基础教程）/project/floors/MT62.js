main.floors.MT62=
{
    "floorId": "MT62",
    "title": "62 层",
    "name": "62 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 20,
    "defaultGround": 150654,
    "bgm": "5.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "1,1": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "10,11": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "9,7": [
            {
                "type": "setValue",
                "name": "flag:door_MT62_10_6",
                "operator": "+=",
                "value": "1"
            }
        ],
        "11,7": [
            {
                "type": "setValue",
                "name": "flag:door_MT62_10_6",
                "operator": "+=",
                "value": "1"
            }
        ],
        "9,10": [
            {
                "type": "setValue",
                "name": "flag:door_MT62_10_9",
                "operator": "+=",
                "value": "1"
            }
        ],
        "11,10": [
            {
                "type": "setValue",
                "name": "flag:door_MT62_10_9",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "10,6": {
            "0": {
                "condition": "flag:door_MT62_10_6==2",
                "currentFloor": true,
                "priority": 0,
                "delayExecute": false,
                "multiExecute": false,
                "data": [
                    {
                        "type": "openDoor"
                    },
                    {
                        "type": "setValue",
                        "name": "flag:door_MT62_10_6",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        },
        "10,9": {
            "0": {
                "condition": "flag:door_MT62_10_9==2",
                "currentFloor": true,
                "priority": 0,
                "delayExecute": false,
                "multiExecute": false,
                "data": [
                    {
                        "type": "openDoor"
                    },
                    {
                        "type": "setValue",
                        "name": "flag:door_MT62_10_9",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        }
    },
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [144,144,144,144,144,144,144,144,144,144,144,144,144],
    [144, 88,  0,348,144, 33,  0,144,576,144,  0,577,144],
    [144, 86,144, 33, 82,576, 33,265, 86,265,577, 59,144],
    [144,348,  0,144,144,144,144,144,144,144,144,144,144],
    [144,  0, 32,144, 27, 82,579,144,572,144,144,587,144],
    [144, 32,  0,265,  0,144,349,  0,352,144,587,144,144],
    [144, 81,144,144, 81,144, 81,144,144,144, 85,144,144],
    [144,338,144, 28,  0,144,347,577,144,351,  0,351,144],
    [144,579,346,  0, 28,144, 86,144,144,  0, 47,  0,144],
    [144,144,144,144,348, 82,265, 58,144,144, 85,144,144],
    [144,  0,352,  0, 21,144, 86,144,144,350,  0,350,144],
    [144,576,144, 21,  0,144,347, 58,265,  0, 87,  0,144],
    [144,144,144,144,144,144,144,144,144,144,144,144,144]
],
    "bgmap": [

],
    "fgmap": [

],
    "bg2map": [
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,151316,151316,  0,151316,  0,151316,151316,  0],
    [  0,  0,  0,  0,  0,151316,151316,151316,151316,151316,151316,151316,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
],
    "fg2map": [

]
}