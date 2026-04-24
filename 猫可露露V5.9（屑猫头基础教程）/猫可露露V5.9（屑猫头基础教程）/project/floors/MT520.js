main.floors.MT520=
{
    "floorId": "MT520",
    "title": "520 层",
    "name": "520 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 2000000000,
    "defaultGround": 160922,
    "bgm": "29.mp3",
    "weather": [
        "sun",
        2
    ],
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "7,11": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "6,4": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "9,8": [
            {
                "type": "setValue",
                "name": "flag:door_MT520_10_7",
                "operator": "+=",
                "value": "1"
            }
        ],
        "11,8": [
            {
                "type": "setValue",
                "name": "flag:door_MT520_10_7",
                "operator": "+=",
                "value": "1"
            }
        ],
        "9,5": [
            {
                "type": "setValue",
                "name": "flag:door_MT520_10_4",
                "operator": "+=",
                "value": "1"
            }
        ],
        "11,5": [
            {
                "type": "setValue",
                "name": "flag:door_MT520_10_4",
                "operator": "+=",
                "value": "1"
            }
        ],
        "10,1": [
            {
                "type": "setValue",
                "name": "flag:door_MT520_6_7",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "10,7": {
            "0": {
                "condition": "flag:door_MT520_10_7==2",
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
                        "name": "flag:door_MT520_10_7",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        },
        "10,4": {
            "0": {
                "condition": "flag:door_MT520_10_4==2",
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
                        "name": "flag:door_MT520_10_4",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            },
            "1": null
        },
        "10,3": {
            "0": {
                "condition": "flag:door_MT520_10_4==2",
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
                        "name": "flag:door_MT520_10_4",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        },
        "6,7": {
            "0": {
                "condition": "flag:door_MT520_6_7==1",
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
                        "name": "flag:door_MT520_6_7",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            },
            "1": null
        },
        "6,8": {
            "0": {
                "condition": "flag:door_MT520_6_7==1",
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
                        "name": "flag:door_MT520_6_7",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        },
        "6,9": {
            "0": {
                "condition": "flag:door_MT520_6_7==1",
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
                        "name": "flag:door_MT520_6_7",
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
    [186,186,186,186,160472,160473,160474,186,186,1010,  0, 22,186],
    [186,160900,186,186,160480,160481,160482,186,186,  0,872,  0,186],
    [186,186,186,186,160488,160489,160490,186,186, 22,  0,1010,186],
    [160472,160473,160474,186,186,  4,  4,  4,186,186, 85,186,186],
    [160480,160481,160482,186,  4,  4, 87,  4,  4,186, 85,186,186],
    [160488,160489,160490,186,  4,  4, 86,  4,  4,1526,  0,1526,186],
    [186,186,186,186,  4,  4, 86,  4,  4,186,1009,186,186],
    [186,186,160901,186,  4,  4, 85,  4,  4,186, 85,186,186],
    [186,186,186,186,186,186, 85,186,186,1521,  0,1521,186],
    [186,160472,160473,160474,186,186, 85,186,186,733,  0,733, 16],
    [186,160480,160481,160482,186, 15, 47,  0, 47, 86,186,186,1010],
    [186,160488,160489,160490, 15,1009,186, 88,186,186,186,186, 16],
    [1010, 15,1009, 15,1010,186,186,186,186,1010,1011, 83,1011]
],
    "bgmap": [

],
    "fgmap": [
    [153,153,153,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [153,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
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
    "bg2map": [

],
    "fg2map": [

]
}