main.floors.MT480=
{
    "floorId": "MT480",
    "title": "480 层",
    "name": "480 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 500000000,
    "defaultGround": 300049,
    "bgm": "27.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "6,12": [
            "打完军师后强制战斗！"
        ]
    },
    "changeFloor": {
        "6,3": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "1,11": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "5,6": [
            {
                "type": "setValue",
                "name": "flag:door_MT480_6_9",
                "operator": "+=",
                "value": "1"
            }
        ],
        "7,6": [
            {
                "type": "setValue",
                "name": "flag:door_MT480_6_9",
                "operator": "+=",
                "value": "1"
            }
        ],
        "5,8": [
            {
                "type": "setValue",
                "name": "flag:door_MT480_6_9",
                "operator": "+=",
                "value": "1"
            }
        ],
        "7,8": [
            {
                "type": "setValue",
                "name": "flag:door_MT480_6_9",
                "operator": "+=",
                "value": "1"
            }
        ],
        "6,12": [
            {
                "type": "setValue",
                "name": "flag:door_MT480_2_11",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "6,9": {
            "0": {
                "condition": "flag:door_MT480_6_9==4",
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
                        "name": "flag:door_MT480_6_9",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            },
            "1": null
        },
        "6,10": {
            "0": {
                "condition": "flag:door_MT480_6_9==4",
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
                        "name": "flag:door_MT480_6_9",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        },
        "2,11": {
            "0": {
                "condition": "flag:door_MT480_2_11==1",
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
                        "name": "flag:door_MT480_2_11",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            },
            "1": null
        },
        "10,11": {
            "0": {
                "condition": "flag:door_MT480_2_11==1",
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
                        "name": "flag:door_MT480_2_11",
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
    [300009,300009,300009,300009,300009,300012,300017,300011,300009,300009,300009,300009,300009],
    [300009,300009,300009,300009,300009,300010,300025,300008,300009,300009,300009,300009,300009],
    [300009,300009,300009,300009,300012,300018,300033,300016,300011,300009,300009,300009,300009],
    [300009,300009,300009,300012,300018,300026, 88,300024,300016,300011,300009,300009,300009],
    [300009,300012,300017,300018,300026,300034, 86,300032,300024,300016,300017,300011,300009],
    [300017,300018,300025,300026,300034,  0, 24,  0,300032,300024,300025,300016,300017],
    [300025,300026,300033,300034,  4,1374,  0,1374,  4,300032,300033,300024,300025],
    [300033,300034,  4,  4,  4,  0, 24,  0,  4,  4,  4,300032,300033],
    [  4,  4,  4, 86, 84,1374,  0,1374, 84, 86,  4,  4,  4],
    [  4,  4,1011, 86,  4,  4, 85,  4,  4, 86,1011,  4,  4],
    [  4,  4,  4,  4,  4,  4, 85,  4,  4,  4,  4,  4,  4],
    [  4, 87, 85,  0,  0,  0,  0,  0,  0,  0, 85,1012,  4],
    [  4,  4,  4,  4,  4,  0,1375,  0,  4,  4,  4,  4,  4]
],
    "bgmap": [

],
    "fgmap": [

],
    "bg2map": [

],
    "fg2map": [

]
}