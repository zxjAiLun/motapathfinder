main.floors.MT766=
{
    "floorId": "MT766",
    "title": "766 层",
    "name": "766 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 10000000000000,
    "defaultGround": 1891,
    "bgm": "40.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "1,11": {
            "floorId": "MT765",
            "loc": [
                1,
                11
            ]
        },
        "6,11": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "1,1": [
            {
                "type": "setValue",
                "name": "flag:door_MT766_1_3",
                "operator": "+=",
                "value": "1"
            }
        ],
        "2,2": [
            {
                "type": "setValue",
                "name": "flag:door_MT766_1_3",
                "operator": "+=",
                "value": "1"
            }
        ],
        "3,1": [
            {
                "type": "setValue",
                "name": "flag:door_MT766_1_3",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "1,3": {
            "0": {
                "condition": "flag:door_MT766_1_3==3",
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
                        "name": "flag:door_MT766_1_3",
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
    [1882,1882,1882,1882,1882,1882,1882,1882,1882,1882,1882,1882,1882],
    [1882,1968,  0,1968,1882,1014, 47,1486,1882, 21, 21, 21,1882],
    [  4,  0,1968,  0,1882,1963,1882,1964,1882, 22,1969, 21,1882],
    [2071, 85,  0,1019,1882,2070,1882,2070,1882,1882, 15,1882,1882],
    [  4,1882, 16,1882,1882, 82,1882, 15,1882,644,1968,644,1882],
    [1882,  0,1012,  0,1965,  0,1962,  0,1965,  0,1015,  0,1882],
    [1882,1963,  0,643,1882,1882, 81,1882,1882,1012,  0,1966,1882],
    [1882, 81,1882, 81,1882,644,  0,643,1882,1882,1882, 81,1882],
    [1882,1967,1882,  0,1966,  0, 15,  0,1964,  0,1963,1015,1882],
    [1882,  0,  4,1973,  4,  4, 83,  4,  4, 81,1882,1882,1882],
    [1882,  0,  4,  0,  4,1012,1438,1012,  4,1962,646,  0,1882],
    [1882, 88,  4,643, 16,  0, 87,  0,  4,  0,732, 21,1882],
    [1882,1882,  4,  4,  4,  4,  4,  4,  4,1882,1882,1882,1882]
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