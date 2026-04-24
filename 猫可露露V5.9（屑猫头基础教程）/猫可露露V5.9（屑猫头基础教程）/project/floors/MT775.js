main.floors.MT775=
{
    "floorId": "MT775",
    "title": "775 层",
    "name": "775 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 10000000000000,
    "defaultGround": 1893,
    "bgm": "40.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "2,10": [
            {
                "type": "if",
                "condition": "(flag:775fa==0)",
                "true": [
                    "这个墙好像不是暗墙呢。\n那个血瓶难道会有人开那么多门拿吗。",
                    {
                        "type": "setValue",
                        "name": "flag:775fa",
                        "value": "1"
                    }
                ],
                "false": []
            },
            {
                "type": "if",
                "condition": "((flag:775fb==1)&&(flag:775fa==1))",
                "true": [
                    "\t[纳可]等等，墙缝里居然藏着东西……",
                    {
                        "type": "setValue",
                        "name": "item:I1030",
                        "value": "1"
                    },
                    "得到了幸运数字 - 5！",
                    {
                        "type": "setValue",
                        "name": "flag:775fa",
                        "value": "2"
                    },
                    {
                        "type": "setValue",
                        "name": "flag:775fb",
                        "value": "2"
                    }
                ],
                "false": [
                    "真是令人费解……"
                ]
            }
        ],
        "10,10": [
            {
                "type": "if",
                "condition": "(flag:775fb==0)",
                "true": [
                    "这个墙好像不是暗墙呢。\n那个血瓶难道会有人开那么多门拿吗。",
                    {
                        "type": "setValue",
                        "name": "flag:775fb",
                        "value": "1"
                    }
                ],
                "false": []
            },
            {
                "type": "if",
                "condition": "((flag:775fb==1)&&(flag:775fa==1))",
                "true": [
                    "\t[纳可]等等，墙缝里居然藏着东西……",
                    {
                        "type": "setValue",
                        "name": "item:I1030",
                        "value": "1"
                    },
                    "得到了幸运数字 - 5！",
                    {
                        "type": "setValue",
                        "name": "flag:775fa",
                        "value": "2"
                    },
                    {
                        "type": "setValue",
                        "name": "flag:775fb",
                        "value": "2"
                    }
                ],
                "false": [
                    "真是令人费解……"
                ]
            }
        ]
    },
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
    "afterBattle": {},
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [1884,1884,1884,1884,1884,  4,  4,  4,1884,1884,1884,1884,1884],
    [1884,1486,1884,  0, 22,  4, 88,  4, 22,  0,1884,1012,1884],
    [1884, 16,1975,2071,  0,  4, 23,  4,  0,2071, 15, 15,1884],
    [1884, 16,1884,2070,  4,  4, 81,  4,  4,2070,1884, 15,1884],
    [1884, 16,1884, 15,  4,1979,  0,1979,  4, 15,1884, 15,1884],
    [1884,  0,644,1978,  4,  4,1974,  4,  4,1978,644,  0,1884],
    [1884,1977,  0,643,  0, 16,736, 16,  0,643,  0,1977,1884],
    [1884,646,1977,  0,1976,  4, 83,  4,1976,  0,1977,646,1884],
    [1884, 15,1884,1884, 16,  4, 83,  4, 16,1884,1884, 16,1884],
    [1884, 15,1884,1012,1023,  4, 83,  4,1023,1012,1884, 16,1884],
    [1884, 15,1884, 21, 21,  4,2071,  4, 21, 21,1884, 16,1884],
    [1884,1012,1884, 21,1017,  4, 87,  4,1018, 21,1884,1486,1884],
    [1884,1884,1884,1884,1884,  4,  4,  4,1884,1884,1884,1884,1884]
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