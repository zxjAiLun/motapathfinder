main.floors.M9=
{
    "floorId": "M9",
    "title": "心境 M9",
    "name": "心境 M9",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 10000000000000,
    "defaultGround": 1898,
    "bgm": "40.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "6,1": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "6,11": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "1,5": [
            {
                "type": "setValue",
                "name": "flag:door_M9_2_4",
                "operator": "+=",
                "value": "1"
            }
        ],
        "3,5": [
            {
                "type": "setValue",
                "name": "flag:door_M9_2_4",
                "operator": "+=",
                "value": "1"
            }
        ],
        "1,8": [
            {
                "type": "setValue",
                "name": "flag:door_M9_2_7",
                "operator": "+=",
                "value": "1"
            }
        ],
        "3,8": [
            {
                "type": "setValue",
                "name": "flag:door_M9_2_7",
                "operator": "+=",
                "value": "1"
            }
        ],
        "9,5": [
            {
                "type": "setValue",
                "name": "flag:door_M9_10_4",
                "operator": "+=",
                "value": "1"
            }
        ],
        "11,5": [
            {
                "type": "setValue",
                "name": "flag:door_M9_10_4",
                "operator": "+=",
                "value": "1"
            }
        ],
        "9,8": [
            {
                "type": "setValue",
                "name": "flag:door_M9_10_7",
                "operator": "+=",
                "value": "1"
            }
        ],
        "11,8": [
            {
                "type": "setValue",
                "name": "flag:door_M9_10_7",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "2,4": {
            "0": {
                "condition": "flag:door_M9_2_4==2",
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
                        "name": "flag:door_M9_2_4",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        },
        "2,7": {
            "0": {
                "condition": "flag:door_M9_2_7==2",
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
                        "name": "flag:door_M9_2_7",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        },
        "10,4": {
            "0": {
                "condition": "flag:door_M9_10_4==2",
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
                        "name": "flag:door_M9_10_4",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        },
        "10,7": {
            "0": {
                "condition": "flag:door_M9_10_7==2",
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
                        "name": "flag:door_M9_10_7",
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
    [  4,  4,1500,  4,  4,  4,  4,  4,  4,  4,1500,  4,  4],
    [  4,643, 86,1013,  4,  0, 88,  0,  4,736,1012,1014,  4],
    [  4, 86,1761, 86,966,643,  0,643, 83, 83,1016, 22,  4],
    [  4,1013, 86,643,  4,1964,1889,1969,  4,1013,2071,736,  4],
    [  4,  4, 85,  4,  4,2070,1889,2070,  4,  4, 85,  4,  4],
    [1889,1970,  0,1970,1889, 16,1889, 15,1889,1974,  0,1974,1889],
    [1889,  0,1013,  0,1889,2070,1889,2070,1889,  0,646,  0,1889],
    [1889,1889, 85,1889,1889,1965,1889,1963,1889,1889, 85,1889,1889],
    [1889,1967,  0,1967,1889,1014,  0,1014,1889,1966,  0,1966,1889],
    [1889,  0,1014,  0,1889,1889,1972,1889,1889,  0,1019,  0,1889],
    [1889,1889, 81,1889,1889,1015, 50,1015,1889,1889, 81,1889,1889],
    [1889,1486,  0, 21,1969,  0, 87,  0,1969, 21,  0,1486,1889],
    [1889,1889,1889,1889,1889,1889,1889,1889,1889,1889,1889,1889,1889]
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