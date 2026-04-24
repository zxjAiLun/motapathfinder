main.floors.M14=
{
    "floorId": "M14",
    "title": "心境 M14",
    "name": "心境 M14",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [
        {
            "name": "05.png",
            "canvas": "bg",
            "x": 0,
            "y": 0
        }
    ],
    "ratio": 10000000000000,
    "defaultGround": 1902,
    "bgm": "40.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "11,1": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "1,1": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "9,5": [
            {
                "type": "setValue",
                "name": "flag:door_M14_10_8",
                "operator": "+=",
                "value": "1"
            }
        ],
        "11,5": [
            {
                "type": "setValue",
                "name": "flag:door_M14_10_8",
                "operator": "+=",
                "value": "1"
            }
        ],
        "11,7": [
            {
                "type": "setValue",
                "name": "flag:door_M14_10_8",
                "operator": "+=",
                "value": "1"
            }
        ],
        "9,7": [
            {
                "type": "setValue",
                "name": "flag:door_M14_10_8",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "10,8": {
            "0": {
                "condition": "flag:door_M14_10_8==4",
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
                        "name": "flag:door_M14_10_8",
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
    [1901,1901,1901,1901,1901,1901,1901,1901,1901,1901,1901,1901,1901],
    [1901, 87,  0, 16,1971,  0,1974, 81,1975, 21,  0, 88,1901],
    [1901,  0,  0,1901,  0,1012,  0,1901, 81,1901,1901,1901,1901],
    [1901, 15,1901,1901,644,2071, 21,1901,643,  0,1967, 22,1901],
    [1901,1975,  0,1901,1901, 81,1901,1901,1901, 82, 82,1901,1901],
    [1901,  0,1012,1901,643,  0,1971,2070,1901,1977,  0,1977,1901],
    [1901,643, 21,1901,1976,1901,1901, 81,1901,  0, 23,  0,1901],
    [1901,  0,1975, 81, 21,  0,1972,2070,1901,1972,  0,1972,1901],
    [1901, 81,1901,1901,1901,1901,1901,1901,  4,  4, 85,  4,  4],
    [1901,644,  0,1976,1901,  0,1974, 22,  4,1012,646, 86,  4],
    [1901,1970,1901,  0,1901, 21,1901,1975, 83,1019,943,1013,  4],
    [1901, 15,1974,644, 82,  0, 81,1014,  4, 86,1014,1012,  4],
    [1901,1901,1901,1901,1901,1901,1901,1901,  4,  4,  4,  4,  4]
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