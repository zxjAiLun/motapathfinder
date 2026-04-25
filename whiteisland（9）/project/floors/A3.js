main.floors.A3=
{
    "floorId": "A3",
    "title": "试炼间",
    "name": "试炼间",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 1,
    "defaultGround": 80020,
    "bgm": "1.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "6,11": {
            "floorId": ":before",
            "stair": "upFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "1,2": [
            {
                "type": "setValue",
                "name": "flag:door_A3_6_1",
                "operator": "+=",
                "value": "1"
            }
        ],
        "11,2": [
            {
                "type": "setValue",
                "name": "flag:door_A3_6_1",
                "operator": "+=",
                "value": "1"
            }
        ],
        "4,2": [
            {
                "type": "setValue",
                "name": "flag:door_A3_6_1",
                "operator": "+=",
                "value": "1"
            }
        ],
        "3,3": [
            {
                "type": "setValue",
                "name": "flag:door_A3_6_1",
                "operator": "+=",
                "value": "1"
            }
        ],
        "8,2": [
            {
                "type": "setValue",
                "name": "flag:door_A3_6_1",
                "operator": "+=",
                "value": "1"
            }
        ],
        "9,3": [
            {
                "type": "setValue",
                "name": "flag:door_A3_6_1",
                "operator": "+=",
                "value": "1"
            }
        ],
        "1,6": [
            {
                "type": "setValue",
                "name": "flag:door_A3_6_4",
                "operator": "+=",
                "value": "1"
            }
        ],
        "3,5": [
            {
                "type": "setValue",
                "name": "flag:door_A3_6_4",
                "operator": "+=",
                "value": "1"
            }
        ],
        "4,6": [
            {
                "type": "setValue",
                "name": "flag:door_A3_6_4",
                "operator": "+=",
                "value": "1"
            }
        ],
        "8,6": [
            {
                "type": "setValue",
                "name": "flag:door_A3_6_4",
                "operator": "+=",
                "value": "1"
            }
        ],
        "9,5": [
            {
                "type": "setValue",
                "name": "flag:door_A3_6_4",
                "operator": "+=",
                "value": "1"
            }
        ],
        "11,6": [
            {
                "type": "setValue",
                "name": "flag:door_A3_6_4",
                "operator": "+=",
                "value": "1"
            }
        ],
        "6,0": [
            {
                "type": "if",
                "condition": "(item:I582==1)",
                "true": [
                    {
                        "type": "win",
                        "reason": "试炼间 Easy"
                    }
                ],
                "false": []
            },
            {
                "type": "win",
                "reason": "试炼间 Chaos"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "6,1": {
            "0": {
                "condition": "flag:door_A3_6_1==6",
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
                        "name": "flag:door_A3_6_1",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        },
        "6,4": {
            "0": {
                "condition": "flag:door_A3_6_4==6",
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
                        "name": "flag:door_A3_6_4",
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
    [140,140, 31,140,140,140,218,140,140,140, 31,140,140],
    [140,140, 81,140,140,  0, 85,  0,140,140, 81,140,140],
    [140,209,  0,  0,209,  0,  0,  0,209,  0,  0,209,140],
    [140,  0,  0,209,  0, 33,  0, 33,  0,209,  0,  0,140],
    [140,140,140,140,140,140, 85,140,140,140,140,140,140],
    [140,  0,  0,211,  0, 34,  0, 34,  0,211,  0,  0,140],
    [140,211,  0,  0,211,  0,  0,  0,211,  0,  0,211,140],
    [140,140,140,140,140,140, 83,140,140,140,140,140,140],
    [140, 27,209,  0,208, 31,211, 21,208,  0,209, 23,140],
    [140,212,140,140,  0,140, 82,140,  0,140,140,212,140],
    [140,  0,140,140,578,140, 81,140, 31,140,140,  0,140],
    [140, 28, 81, 81,211, 32, 88, 32,211, 81, 81, 29,140],
    [140,140,140,140,140,140,140,140,140,140,140,140,140]
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