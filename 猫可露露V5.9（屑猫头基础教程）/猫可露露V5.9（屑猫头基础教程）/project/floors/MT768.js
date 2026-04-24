main.floors.MT768=
{
    "floorId": "MT768",
    "title": "768 层",
    "name": "768 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 10000000000000,
    "defaultGround": 1892,
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
        "1,8": [
            {
                "type": "setValue",
                "name": "flag:door_MT768_2_7",
                "operator": "+=",
                "value": "1"
            }
        ],
        "3,8": [
            {
                "type": "setValue",
                "name": "flag:door_MT768_2_7",
                "operator": "+=",
                "value": "1"
            }
        ],
        "1,5": [
            {
                "type": "setValue",
                "name": "flag:door_MT768_2_4",
                "operator": "+=",
                "value": "1"
            }
        ],
        "3,5": [
            {
                "type": "setValue",
                "name": "flag:door_MT768_2_4",
                "operator": "+=",
                "value": "1"
            }
        ],
        "9,5": [
            {
                "type": "setValue",
                "name": "flag:door_MT768_10_4",
                "operator": "+=",
                "value": "1"
            }
        ],
        "11,5": [
            {
                "type": "setValue",
                "name": "flag:door_MT768_10_4",
                "operator": "+=",
                "value": "1"
            }
        ],
        "9,8": [
            {
                "type": "setValue",
                "name": "flag:door_MT768_10_7",
                "operator": "+=",
                "value": "1"
            }
        ],
        "11,8": [
            {
                "type": "setValue",
                "name": "flag:door_MT768_10_7",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "2,7": {
            "0": {
                "condition": "flag:door_MT768_2_7==2",
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
                        "name": "flag:door_MT768_2_7",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        },
        "2,4": {
            "0": {
                "condition": "flag:door_MT768_2_4==2",
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
                        "name": "flag:door_MT768_2_4",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        },
        "10,4": {
            "0": {
                "condition": "flag:door_MT768_10_4==2",
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
                        "name": "flag:door_MT768_10_4",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        },
        "10,7": {
            "0": {
                "condition": "flag:door_MT768_10_7==2",
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
                        "name": "flag:door_MT768_10_7",
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
    [  4,1013, 86,643,  4,1964,1883,1969,  4,1013,2071,736,  4],
    [  4,  4, 85,  4,  4,2070,1883,2070,  4,  4, 85,  4,  4],
    [1883,1970,  0,1970,1883, 16,1883, 15,1883,1968,  0,1968,1883],
    [1883,  0,1013,  0,1883,2070,1883,2070,1883,  0,646,  0,1883],
    [1883,1883, 85,1883,1883,1965,1883,1963,1883,1883, 85,1883,1883],
    [1883,1967,  0,1967,1883,644,  0,644,1883,1966,  0,1966,1883],
    [1883,  0,1014,  0,1883,1883,1972,1883,1883,  0,1019,  0,1883],
    [1883,1883, 81,1883,1883,1015, 50,1015,1883,1883, 81,1883,1883],
    [1883,1486,  0, 21,1969,  0, 87,  0,1969, 21,  0,1486,1883],
    [1883,1883,1883,1883,1883,1883,1883,1883,1883,1883,1883,1883,1883]
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