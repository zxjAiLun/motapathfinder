main.floors.MT310=
{
    "floorId": "MT310",
    "title": "310 层",
    "name": "310 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [
        {
            "name": "03.png",
            "canvas": "bg",
            "x": 0,
            "y": 0
        }
    ],
    "ratio": 1000000,
    "defaultGround": 976,
    "bgm": "19.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "11,11": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "11,9": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "5,1": [
            {
                "type": "setValue",
                "name": "flag:door_MT310_4_2",
                "operator": "+=",
                "value": "1"
            }
        ],
        "5,3": [
            {
                "type": "setValue",
                "name": "flag:door_MT310_4_2",
                "operator": "+=",
                "value": "1"
            }
        ],
        "2,1": [
            {
                "type": "setValue",
                "name": "flag:door_MT310_0_1",
                "operator": "+=",
                "value": "1"
            }
        ],
        "3,2": [
            {
                "type": "setValue",
                "name": "flag:door_MT310_0_1",
                "operator": "+=",
                "value": "1"
            }
        ],
        "2,3": [
            {
                "type": "setValue",
                "name": "flag:door_MT310_0_1",
                "operator": "+=",
                "value": "1"
            }
        ],
        "8,1": [
            {
                "type": "setValue",
                "name": "flag:door_MT310_9_2",
                "operator": "+=",
                "value": "1"
            }
        ],
        "8,3": [
            {
                "type": "setValue",
                "name": "flag:door_MT310_9_2",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "4,2": {
            "0": {
                "condition": "flag:door_MT310_4_2==2",
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
                        "name": "flag:door_MT310_4_2",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        },
        "0,1": {
            "0": {
                "condition": "flag:door_MT310_0_1==3",
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
                        "name": "flag:door_MT310_0_1",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            },
            "1": null
        },
        "0,3": {
            "0": {
                "condition": "flag:door_MT310_0_1==3",
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
                        "name": "flag:door_MT310_0_1",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        },
        "9,2": {
            "0": {
                "condition": "flag:door_MT310_9_2==2",
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
                        "name": "flag:door_MT310_9_2",
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
    [160,160,160,160,160,160,160,160,160,160,160,160,160],
    [ 85,  0,1081,  0,160,1080,  0,160,1084,160,  0,635,160],
    [644, 83,620,1081, 85,  0,636,1078, 60, 85,636,  0,160],
    [ 85,  0,1081,  0,160,1080,  0,160,1084,160,160,160,160],
    [160,160,160,160,160,160, 82,160,160,160,160,160,160],
    [160,160,160,160,160,160,585,160,577,160,619,584,160],
    [160,160,160,619,160,160,  0, 21,1083,586,160,1085,160],
    [160,637,  0,1082, 22, 82,1081,  0, 82,1079,  0,576,160],
    [160,160,638,160, 82,160,160,1082,160,160, 81,160,160],
    [160,160,160,587,1088, 21,160,584,1085,160,  0, 87,160],
    [160,160,160,160,160,1086, 81,1079,620,  0,1077,160,160],
    [160,621,160,636, 16,635,160,577,160, 22,  0, 88,160],
    [160,160,160,160,160,160,160,160,160,160,160,160,160]
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